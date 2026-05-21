/**
 * PluginHost — orchestrates plugin registration, lifecycle, and
 * contribution merging.
 *
 * Lifecycle:
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
 * Discord client is intentionally NOT a constructor dependency, so the
 * host stays fully unit-testable without discord.js. It emits effective
 * registries + an {@link EventDispatcher} that BaseBot attaches to the
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
import { PluginLifecycleRunner, type LifecycleHost, type RegisteredPlugin } from './host/lifecycle';
import type { ContributedRegistry, DisabledPlugin, Plugin, PluginId, TypedResolver } from './types';

// Public errors live in `host/errors.ts`. Re-exported here so callers
// can import them from `core/plugin`.
export const PluginRegistrationError = PluginRegistrationErrorClass;
export type PluginRegistrationError = PluginRegistrationErrorClass;
export const CriticalPluginFailureError = CriticalPluginFailureErrorClass;
export type CriticalPluginFailureError = CriticalPluginFailureErrorClass;
export const DependencyDisabledError = DependencyDisabledErrorClass;
export type DependencyDisabledError = DependencyDisabledErrorClass;

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export interface PluginHostOptions {
  readonly container: ServiceContainer;
  readonly logger: Logger;
  readonly translator: Translator;
  readonly clock: Clock;
  /** Per-handler-type registries shipped by codegen. */
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
   * {@link finalizeRegistration} time so cascade-disable runs in
   * O(|edges|) when a plugin fails.
   */
  private dependents: Map<PluginId, Set<PluginId>> = new Map();
  private effectiveRegistries: EffectiveRegistries | undefined;
  private readonly dispatcher: EventDispatcher;
  /**
   * Lifecycle runner — built lazily after {@link finalizeRegistration}
   * so it captures the finalized `order` / `dependents`. Phase logic
   * lives in `host/lifecycle.ts`; the host only wires it.
   */
  private lifecycleRunner: PluginLifecycleRunner | undefined;

  constructor(private readonly options: PluginHostOptions) {
    this.dispatcher = new EventDispatcher(options.logger);
  }

  // -------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------

  /**
   * Register a plugin with its raw (un-validated) config. Performs:
   *   1. duplicate-id check
   *   2. scope check (`'guild'` rejected)
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
        `PluginHost.register: per-guild plugin scope is not supported (plugin "${plugin.id}").`,
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

  /**
   * Merge codegen-shipped + plugin-contributed handlers into the
   * effective per-handler-type registries. Cached after the first call.
   * Implementation lives in `host/contributes-merger.ts`.
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

  /** Event dispatcher consumed by BaseBot to attach Discord events. */
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
  // Lifecycle — thin delegation to PluginLifecycleRunner (D6 split)
  // -------------------------------------------------------------------

  /** Run `init` on every enabled plugin in topological order. */
  public async initAll(): Promise<void> {
    await this.getLifecycleRunner().runInit();
  }

  /**
   * Run `start` on every enabled plugin in topological order, then
   * attach every enabled plugin's event subscriptions to the host's
   * {@link EventDispatcher}.
   *
   * Wiring contract for BaseBot: events do **not** flow until
   * `startAll()` resolves. Callers MUST defer
   * `client.on(name, (...args) => host.getEventDispatcher().emit(name, ...args))`
   * until after the awaited `startAll()` returns, otherwise plugins
   * whose `start` hook hasn't finished can still observe events and
   * see a partially-initialised world.
   */
  public async startAll(): Promise<void> {
    await this.getLifecycleRunner().runStart();
  }

  /** Run `onReady` on every enabled plugin in topological order. */
  public async readyAll(): Promise<void> {
    await this.getLifecycleRunner().runReady();
  }

  /**
   * Run `onShutdown` in **reverse** topological order. Failures are
   * always non-fatal here — the bot is shutting down regardless.
   */
  public async shutdownAll(): Promise<void> {
    await this.getLifecycleRunner().runShutdown();
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  /**
   * Lazily build the lifecycle runner, exposing the host's state to it
   * through the narrow {@link LifecycleHost} interface. Built lazily so
   * it captures the finalized `order` and `dependents`.
   */
  private getLifecycleRunner(): PluginLifecycleRunner {
    if (this.lifecycleRunner === undefined) {
      this.lifecycleRunner = new PluginLifecycleRunner(this.buildLifecycleHost());
    }
    return this.lifecycleRunner;
  }

  /** Adapt the host's mutable state into the narrow {@link LifecycleHost}. */
  private buildLifecycleHost(): LifecycleHost {
    return {
      registered: this.registered,
      order: this.order,
      disabled: this.disabled,
      dependents: this.dependents,
      resolve: this.buildResolver(),
      dispatcher: this.dispatcher,
      logger: this.options.logger,
      translator: this.options.translator,
      clock: this.options.clock,
    };
  }

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

  // Topology helpers live in `host/topology.ts`. These private methods
  // are thin wrappers that keep the lifecycle call sites concise.
  private topologicalOrder(): readonly PluginId[] {
    return topologicalOrder(this.registered);
  }

  private buildDependentsIndex(): Map<PluginId, Set<PluginId>> {
    return buildDependentsIndex(this.registered);
  }

  private buildResolver(): TypedResolver {
    const container = this.options.container;
    return <T>(token: ServiceToken<T>): T => container.resolve<T>(token);
  }
}

// Re-export the merge-time error so consumers can `instanceof`-narrow.
export { DuplicateContributionError };
// DependencyDisabledError already exported above (class declaration).
