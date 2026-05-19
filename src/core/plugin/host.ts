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
import { DuplicateContributionError } from './registries';
import {
  buildEffectiveRegistries as buildEffectiveRegistriesFn,
  type EffectiveRegistries as EffectiveRegistriesType,
} from './host/contributes-merger';
import {
  PluginRegistrationError as PluginRegistrationErrorClass,
  CriticalPluginFailureError as CriticalPluginFailureErrorClass,
  DependencyDisabledError as DependencyDisabledErrorClass,
} from './host/errors';
import { topologicalOrder, buildDependentsIndex } from './host/topology';
import type {
  ContributedRegistry,
  DisabledPlugin,
  Plugin,
  PluginEventSubscriptions,
  PluginId,
  PluginInitContext,
  PluginRuntimeContext,
  PluginRuntimeServices,
  PluginStartContext,
  TypedResolver,
} from './types';

// Public errors live in `host/errors.ts` (audit C-8 split). Re-exported
// here so existing callers continue to import them from `core/plugin`.
export const PluginRegistrationError = PluginRegistrationErrorClass;
export type PluginRegistrationError = PluginRegistrationErrorClass;
export const CriticalPluginFailureError = CriticalPluginFailureErrorClass;
export type CriticalPluginFailureError = CriticalPluginFailureErrorClass;
export const DependencyDisabledError = DependencyDisabledErrorClass;
export type DependencyDisabledError = DependencyDisabledErrorClass;

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
export type EffectiveRegistries = EffectiveRegistriesType;

export class PluginHost {
  private readonly registered = new Map<PluginId, RegisteredPlugin>();
  private readonly disabled = new Map<PluginId, DisabledPlugin>();
  private order: readonly PluginId[] = [];
  /**
   * Forward dependency edges: `dependents.get(X)` is the set of
   * plugins that name X in their `dependencies`. Populated at
   * {@link finalizeRegistration} time so cascade-disable can run in
   * O(|edges|) when a plugin fails.
   */
  private dependents: Map<PluginId, Set<PluginId>> = new Map();
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
    this.dependents = this.buildDependentsIndex();
  }

  /** Merge codegen registries with plugin contributions; cached. */
  /**
   * Merge codegen-shipped + plugin-contributed handlers into the
   * effective per-handler-type registries. Cached after the first call.
   * Implementation extracted to `host/contributes-merger.ts` (audit
   * C-8 split).
   */
  public buildEffectiveRegistries(): EffectiveRegistries {
    if (this.effectiveRegistries !== undefined) return this.effectiveRegistries;
    const built = buildEffectiveRegistriesFn(
      this.order,
      this.registered,
      this.options.coreRegistries,
    );
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

  // Topology helpers extracted to `host/topology.ts` (audit C-8 split).
  // These private methods stay as thin wrappers so the lifecycle
  // sites keep their original call shape.
  private topologicalOrder(): readonly PluginId[] {
    return topologicalOrder(this.registered);
  }

  private buildDependentsIndex(): Map<PluginId, Set<PluginId>> {
    return buildDependentsIndex(this.registered);
  }

  /**
   * Disable every plugin that depends (transitively) on `failedId`.
   * Each cascade victim is marked with a {@link DependencyDisabledError}
   * whose `cause` is the original failure, so the disabled set is
   * self-explanatory for operators.
   *
   * Returns the list of victims that were marked `critical` — caller
   * folds them into the critical-failure rethrow.
   */
  private cascadeDisable(
    failedId: PluginId,
    phase: DisabledPlugin['phase'],
    rootCause: Error,
  ): readonly CriticalPluginFailureError[] {
    const criticals: CriticalPluginFailureError[] = [];
    const queue: PluginId[] = [failedId];
    const seen = new Set<PluginId>([failedId]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const dependent of this.dependents.get(current) ?? []) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        if (this.disabled.has(dependent)) continue;
        const entry = this.registered.get(dependent);
        if (entry === undefined) continue;
        const cascadeErr = new DependencyDisabledError(dependent, failedId, rootCause);
        this.disabled.set(dependent, { id: dependent, phase, error: cascadeErr });
        this.options.logger.warn(
          {
            plugin: dependent,
            phase,
            dependency: failedId,
            cause: rootCause instanceof Error ? { message: rootCause.message } : undefined,
          },
          'plugin disabled because its dependency failed; lifecycle hook will not run',
        );
        if (entry.plugin.critical === true) {
          criticals.push(new CriticalPluginFailureError(dependent, phase, cascadeErr));
        }
        queue.push(dependent);
      }
    }
    return criticals;
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
        // Cascade-disable every plugin that (transitively) depended
        // on this one — their lifecycle hooks would observe a partly-
        // initialised world otherwise. Cascade victims marked
        // `critical: true` also fold into the rethrow list.
        const cascaded = this.cascadeDisable(id, phase, error);
        criticalFailures.push(...cascaded);
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
// DependencyDisabledError already exported above (class declaration).
