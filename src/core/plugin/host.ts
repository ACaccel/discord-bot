/**
 * PluginHost — orchestrates plugin registration, lifecycle, and
 * contribution merging.
 *
 * Lifecycle (per plan §1.1.4):
 *   register(plugin)*    -- captured immediately; configSchema runs.
 *   register() returns   -- topology + missing-dep checked here too.
 *   buildEffectiveRegistries()  -- merge plugin `contributes` with core.
 *   initAll()  -- topo order; throw in a plugin disables it (or aborts
 *                 the bot if critical: true).
 *   startAll() -- topo order; same disabled semantics.
 *   readyAll() -- topo order; failures only logged (already past start).
 *   shutdownAll() -- REVERSE topo order; failures only logged.
 *
 * Error isolation:
 *   - Non-critical plugin failures => move plugin to {@link DisabledPlugin}
 *     set, log structured, continue.
 *   - Critical plugin failures => collect the error and rethrow at the
 *     end of the phase. Caller (BaseBot) decides how to abort.
 *
 * Discord client is intentionally NOT a constructor dependency. The
 * Phase 4a deliverable is "host fully unit-testable without
 * discord.js"; the host emits effective registries + an
 * {@link EventDispatcher} that Phase 4b's BaseBot will attach to the
 * real `client.on(...)` plumbing.
 *
 * Service-locator guard: plugins receive `services.resolve` (typed
 * tokens only), never the raw container. The host itself takes the
 * container only to satisfy `resolve` calls — it never hands the
 * reference out.
 */
import type { z } from 'zod';
import type { Translator } from '../i18n';
import type { ServiceContainer, ServiceToken } from '../ioc';
import type { Logger } from '../logger';
import type { Clock } from '../time';

import { EventDispatcher } from './event-dispatcher';
import { type ContributionSource, DuplicateContributionError, mergeRegistries } from './registries';
import type {
  ContributedRegistry,
  DisabledPlugin,
  HandlerConstructor,
  Plugin,
  PluginContributions,
  PluginEventSubscriptions,
  PluginId,
  PluginInitContext,
  PluginRuntimeContext,
  PluginRuntimeServices,
  PluginStartContext,
  TypedResolver,
} from './types';

// ---------------------------------------------------------------------------
// Public errors
// ---------------------------------------------------------------------------

/** Throws during `register()`. */
export class PluginRegistrationError extends Error {
  public override readonly name = 'PluginRegistrationError';
  public readonly pluginId: PluginId | undefined;
  public readonly reason:
    | 'DUPLICATE_ID'
    | 'INVALID_CONFIG'
    | 'UNSUPPORTED_SCOPE'
    | 'MISSING_DEPENDENCY'
    | 'CIRCULAR_DEPENDENCY';

  constructor(reason: PluginRegistrationError['reason'], message: string, pluginId?: PluginId) {
    super(message);
    this.reason = reason;
    this.pluginId = pluginId;
  }
}

/** Thrown when a `critical: true` plugin fails during init / start. */
export class CriticalPluginFailureError extends Error {
  public override readonly name = 'CriticalPluginFailureError';
  public readonly pluginId: PluginId;
  public readonly phase: DisabledPlugin['phase'];
  public override readonly cause: unknown;

  constructor(pluginId: PluginId, phase: DisabledPlugin['phase'], cause: unknown) {
    super(
      `CriticalPluginFailureError: plugin "${pluginId}" failed during ${phase}; rethrown because critical=true.`,
      { cause },
    );
    this.pluginId = pluginId;
    this.phase = phase;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

interface RegisteredPlugin {
  readonly plugin: Plugin<unknown>;
  /** Validated config from `configSchema.parse(rawConfig)`. */
  readonly config: unknown;
}

export interface PluginHostOptions {
  readonly container: ServiceContainer;
  readonly logger: Logger;
  readonly translator: Translator;
  readonly clock: Clock;
  /** Per-handler-type registries shipped by codegen — see plan §1.1.3. */
  readonly coreRegistries: {
    readonly commands?: ContributedRegistry;
    readonly buttons?: ContributedRegistry;
    readonly modals?: ContributedRegistry;
    readonly selectMenus?: ContributedRegistry;
    readonly reactions?: ContributedRegistry;
  };
}

/** Result of {@link PluginHost.buildEffectiveRegistries}. */
export interface EffectiveRegistries {
  readonly commands: Readonly<Record<string, HandlerConstructor>>;
  readonly buttons: Readonly<Record<string, HandlerConstructor>>;
  readonly modals: Readonly<Record<string, HandlerConstructor>>;
  readonly selectMenus: Readonly<Record<string, HandlerConstructor>>;
  readonly reactions: Readonly<Record<string, HandlerConstructor>>;
}

export class PluginHost {
  private readonly registered = new Map<PluginId, RegisteredPlugin>();
  private readonly disabled = new Map<PluginId, DisabledPlugin>();
  private order: readonly PluginId[] = [];
  private effectiveRegistries: EffectiveRegistries | undefined;
  private readonly dispatcher: EventDispatcher;

  constructor(private readonly options: PluginHostOptions) {
    this.dispatcher = new EventDispatcher(options.logger);
  }

  // -------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------

  /**
   * Register a plugin with its raw (un-validated) config. Performs:
   *   1. duplicate-id check
   *   2. scope check (4a: `'guild'` rejected)
   *   3. zod parse against `configSchema` (when supplied)
   *
   * Topology checks (missing deps, cycles) run lazily inside
   * {@link finalizeRegistration} so callers can register all plugins
   * before the host validates the graph.
   */
  public register<Config>(plugin: Plugin<Config>, rawConfig?: unknown): void {
    if (this.registered.has(plugin.id)) {
      throw new PluginRegistrationError(
        'DUPLICATE_ID',
        `PluginHost.register: plugin id "${plugin.id}" is already registered.`,
        plugin.id,
      );
    }
    if (plugin.scope !== 'bot') {
      throw new PluginRegistrationError(
        'UNSUPPORTED_SCOPE',
        `PluginHost.register: per-guild plugin scope is not supported until Phase 4b (plugin "${plugin.id}").`,
        plugin.id,
      );
    }
    const config = this.validateConfig(plugin, rawConfig);
    this.registered.set(plugin.id, { plugin: plugin as Plugin<unknown>, config });
  }

  /**
   * Validate the dependency graph and compute the topological order.
   * Must be called after every plugin has been registered and before
   * any lifecycle method.
   */
  public finalizeRegistration(): void {
    this.checkDependencies();
    this.order = this.topologicalOrder();
  }

  /** Merge codegen registries with plugin contributions; cached. */
  public buildEffectiveRegistries(): EffectiveRegistries {
    if (this.effectiveRegistries !== undefined) return this.effectiveRegistries;

    const sourcesFor = (
      pick: (c: PluginContributions) => ContributedRegistry | undefined,
      coreReg: ContributedRegistry | undefined,
    ): ContributionSource[] => {
      const sources: ContributionSource[] = [];
      if (coreReg !== undefined && Object.keys(coreReg).length > 0) {
        // TODO(phase-5): if a later phase introduces multiple codegen
        // sources per handler type, this single `'core'` provenance id
        // would collide with itself. Replace with per-source tagging
        // (`'core:commands'`, `'core:context-menu'`, ...) once that
        // need materialises.
        sources.push({ id: 'core', registry: coreReg });
      }
      // Iterate plugins in registration order; mergeRegistries throws
      // on duplicate name so plugin-vs-plugin conflicts surface both ids.
      for (const id of this.order) {
        const slot = this.registered.get(id);
        if (slot === undefined) continue;
        const reg = pick(slot.plugin.contributes ?? {});
        if (reg !== undefined && Object.keys(reg).length > 0) {
          sources.push({ id, registry: reg });
        }
      }
      return sources;
    };

    const built: EffectiveRegistries = {
      commands: mergeRegistries(
        'command',
        sourcesFor((c) => c.commands, this.options.coreRegistries.commands),
      ),
      buttons: mergeRegistries(
        'button',
        sourcesFor((c) => c.buttons, this.options.coreRegistries.buttons),
      ),
      modals: mergeRegistries(
        'modal',
        sourcesFor((c) => c.modals, this.options.coreRegistries.modals),
      ),
      selectMenus: mergeRegistries(
        'select-menu',
        sourcesFor((c) => c.selectMenus, this.options.coreRegistries.selectMenus),
      ),
      reactions: mergeRegistries(
        'reaction',
        sourcesFor((c) => c.reactions, this.options.coreRegistries.reactions),
      ),
    };
    this.effectiveRegistries = built;
    return built;
  }

  /** Event dispatcher consumed by Phase 4b's BaseBot to attach Discord events. */
  public getEventDispatcher(): EventDispatcher {
    return this.dispatcher;
  }

  /** Snapshot of disabled plugins (id -> reason). */
  public getDisabledPlugins(): readonly DisabledPlugin[] {
    return [...this.disabled.values()];
  }

  /** Snapshot of topological order. Empty until finalizeRegistration. */
  public getOrder(): readonly PluginId[] {
    return this.order;
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  /** Run `init` on every enabled plugin in topological order. */
  public async initAll(): Promise<void> {
    await this.runLifecycle('init', async (entry, ctx) => {
      if (entry.plugin.init !== undefined) {
        await entry.plugin.init(ctx as PluginInitContext<unknown>);
      }
    });
  }

  /**
   * Run `start` on every enabled plugin in topological order, then
   * attach every enabled plugin's event subscriptions to the host's
   * {@link EventDispatcher}.
   *
   * Wiring contract for Phase 4b's BaseBot: events do **not** flow
   * until `startAll()` resolves. Callers MUST defer
   * `client.on(name, (...args) => host.getEventDispatcher().emit(name, ...args))`
   * until after the awaited `startAll()` returns, otherwise plugins
   * whose `start` hook hasn't finished can still observe events and
   * see a partially-initialised world.
   */
  public async startAll(): Promise<void> {
    await this.runLifecycle('start', async (entry, ctx) => {
      if (entry.plugin.start !== undefined) {
        await entry.plugin.start(ctx as PluginStartContext);
      }
    });
    // After every plugin has started, attach event subscriptions so
    // discord.js events fan out as soon as they fire post-ready.
    this.attachEventSubscriptions();
  }

  /** Run `onReady` on every enabled plugin in topological order. */
  public async readyAll(): Promise<void> {
    await this.runLifecycle('onReady', async (entry, ctx) => {
      if (entry.plugin.onReady !== undefined) {
        await entry.plugin.onReady(ctx as PluginRuntimeContext);
      }
    });
  }

  /**
   * Run `onShutdown` in **reverse** topological order. Failures are
   * always non-fatal here — the bot is shutting down regardless.
   */
  public async shutdownAll(): Promise<void> {
    const reverse = [...this.order].reverse();
    for (const id of reverse) {
      if (this.disabled.has(id)) continue;
      const entry = this.registered.get(id);
      if (entry === undefined) continue;
      if (entry.plugin.onShutdown !== undefined) {
        try {
          const ctx = this.buildRuntimeContext(entry);
          await entry.plugin.onShutdown(ctx);
        } catch (err: unknown) {
          this.options.logger.warn(
            {
              plugin: id,
              err: err instanceof Error ? err : new Error(String(err)),
            },
            'plugin onShutdown threw; ignored',
          );
        }
      }
      // Always detach subscriptions — even for plugins that only
      // subscribed to events without registering an onShutdown hook.
      this.dispatcher.unsubscribeAll(id);
    }
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private validateConfig<Config>(plugin: Plugin<Config>, rawConfig: unknown): Config {
    const schema = plugin.configSchema as z.ZodType<Config> | undefined;
    if (schema === undefined) {
      // No schema -> plugin accepts `void`; config is unused.
      return rawConfig as Config;
    }
    const parsed = schema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new PluginRegistrationError(
        'INVALID_CONFIG',
        `PluginHost.register: config for plugin "${plugin.id}" failed validation: ${parsed.error.message}`,
        plugin.id,
      );
    }
    return parsed.data;
  }

  private checkDependencies(): void {
    const allIds = new Set(this.registered.keys());
    for (const [id, entry] of this.registered) {
      for (const dep of entry.plugin.dependencies ?? []) {
        if (!allIds.has(dep.id)) {
          throw new PluginRegistrationError(
            'MISSING_DEPENDENCY',
            `PluginHost.finalizeRegistration: plugin "${id}" depends on "${dep.id}" which is not registered.`,
            id,
          );
        }
      }
    }
  }

  /**
   * Kahn's algorithm. Throws on cycle. Determinism: ties broken by
   * the original registration order via `Map` iteration semantics +
   * a sort on cohorts.
   */
  private topologicalOrder(): readonly PluginId[] {
    const indegree = new Map<PluginId, number>();
    const adjacency = new Map<PluginId, PluginId[]>();
    for (const id of this.registered.keys()) {
      indegree.set(id, 0);
      adjacency.set(id, []);
    }
    for (const [id, entry] of this.registered) {
      for (const dep of entry.plugin.dependencies ?? []) {
        adjacency.get(dep.id)?.push(id);
        indegree.set(id, (indegree.get(id) ?? 0) + 1);
      }
    }

    const queue: PluginId[] = [];
    // Preserve registration order for deterministic output.
    for (const id of this.registered.keys()) {
      if ((indegree.get(id) ?? 0) === 0) queue.push(id);
    }
    const out: PluginId[] = [];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      out.push(next);
      for (const downstream of adjacency.get(next) ?? []) {
        const decremented = (indegree.get(downstream) ?? 0) - 1;
        indegree.set(downstream, decremented);
        if (decremented === 0) {
          queue.push(downstream);
        }
      }
    }

    if (out.length !== this.registered.size) {
      const remaining = [...this.registered.keys()].filter((id) => !out.includes(id));
      throw new PluginRegistrationError(
        'CIRCULAR_DEPENDENCY',
        `PluginHost.finalizeRegistration: circular dependency among plugins [${remaining.join(', ')}].`,
      );
    }
    return Object.freeze(out);
  }

  private buildResolver(): TypedResolver {
    const container = this.options.container;
    return <T>(token: ServiceToken<T>): T => container.resolve<T>(token);
  }

  private buildRuntimeServices(entry: RegisteredPlugin): PluginRuntimeServices {
    return Object.freeze({
      logger: this.options.logger.child({ plugin: entry.plugin.id }),
      translator: this.options.translator,
      clock: this.options.clock,
      resolve: this.buildResolver(),
    });
  }

  private buildRuntimeContext(entry: RegisteredPlugin): PluginRuntimeContext {
    return this.buildRuntimeServices(entry);
  }

  private buildInitContext(entry: RegisteredPlugin): PluginInitContext<unknown> {
    return Object.freeze({
      ...this.buildRuntimeServices(entry),
      config: entry.config,
    }) as PluginInitContext<unknown>;
  }

  private async runLifecycle(
    phase: 'init' | 'start' | 'onReady',
    invoke: (
      entry: RegisteredPlugin,
      ctx: PluginInitContext<unknown> | PluginRuntimeContext,
    ) => Promise<void>,
  ): Promise<void> {
    const criticalFailures: CriticalPluginFailureError[] = [];
    for (const id of this.order) {
      if (this.disabled.has(id)) continue;
      const entry = this.registered.get(id);
      if (entry === undefined) continue;
      try {
        const ctx =
          phase === 'init' ? this.buildInitContext(entry) : this.buildRuntimeContext(entry);
        await invoke(entry, ctx);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.disabled.set(id, { id, phase, error });
        this.options.logger.error(
          {
            plugin: id,
            phase,
            critical: entry.plugin.critical === true,
            err: error,
          },
          'plugin lifecycle hook threw; plugin disabled',
        );
        if (entry.plugin.critical === true) {
          criticalFailures.push(new CriticalPluginFailureError(id, phase, error));
        }
      }
    }
    if (criticalFailures.length > 0) {
      // Surface the first critical failure (preserving cause). The
      // remaining critical failures are still visible in
      // disabledPlugins for diagnostics.
      throw criticalFailures[0];
    }
  }

  private attachEventSubscriptions(): void {
    for (const id of this.order) {
      if (this.disabled.has(id)) continue;
      const entry = this.registered.get(id);
      if (entry === undefined) continue;
      const subs: PluginEventSubscriptions | undefined = entry.plugin.events;
      if (subs === undefined) continue;
      this.dispatcher.subscribe(id, this.buildRuntimeServices(entry), subs);
    }
  }
}

// Re-export the merge-time error so consumers can `instanceof`-narrow.
export { DuplicateContributionError };
