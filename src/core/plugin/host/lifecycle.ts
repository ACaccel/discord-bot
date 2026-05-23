/**
 * Plugin lifecycle runner — owns the `init` / `start` / `onReady` /
 * `onShutdown` phase execution for `PluginHost`.
 *
 * Design rationale: the lifecycle phases live in their own module so
 * adding, removing, or changing a phase is a single-file edit and is
 * independently unit-testable. Coupling to the host is constrained by
 * the narrow {@link LifecycleHost} interface — the compiler forbids
 * this module from reaching into arbitrary host internals, so
 * modularity is type-enforced rather than discipline-enforced.
 */
import type { Translator } from '../../i18n';
import type { Logger } from '../../logger';
import type { Clock } from '../../time';
import type { EventDispatcher } from '../event-dispatcher';
import type {
  DisabledPlugin,
  Plugin,
  PluginEventSubscriptions,
  PluginId,
  PluginInitContext,
  PluginRuntimeContext,
  PluginRuntimeServices,
  PluginStartContext,
  TypedResolver,
} from '../types';
import { CriticalPluginFailureError } from './errors';
import { cascadeDisable } from './topology';

/**
 * A registered plugin together with its validated config. Mirrors the
 * host's internal entry; declared here so the runner does not depend on
 * a host-private type.
 */
export interface RegisteredPlugin {
  readonly plugin: Plugin<unknown>;
  /** Validated config from `configSchema.parse(rawConfig)`. */
  readonly config: unknown;
}

/**
 * Narrow slice of `PluginHost` state the lifecycle runner needs. The
 * host passes itself (adapted) as this interface; the runner can touch
 * nothing else. This is the type-level boundary that keeps
 * `lifecycle.ts` from becoming a "second half of host".
 */
export interface LifecycleHost {
  /** Registered plugins, keyed by id. Read-only for the runner. */
  readonly registered: ReadonlyMap<PluginId, RegisteredPlugin>;
  /** Topological order computed at finalize time. */
  readonly order: readonly PluginId[];
  /** Disabled-plugin map — the runner both reads and writes this. */
  readonly disabled: Map<PluginId, DisabledPlugin>;
  /** Forward dependency edges for cascade-disable. */
  readonly dependents: ReadonlyMap<PluginId, ReadonlySet<PluginId>>;
  /** Typed-token resolver handed to plugin contexts. */
  readonly resolve: TypedResolver;
  /** Event dispatcher subscriptions are attached to after `start`. */
  readonly dispatcher: EventDispatcher;
  readonly logger: Logger;
  readonly translator: Translator;
  readonly clock: Clock;
}

/**
 * Runs plugin lifecycle phases against a {@link LifecycleHost}.
 *
 * Error isolation contract (unchanged from the previous inline
 * implementation):
 *  - Non-critical plugin failure -> plugin disabled, cascade-disable its
 *    dependents, continue the phase.
 *  - Critical plugin failure -> collected and the first is rethrown at
 *    the end of the phase.
 *  - `onShutdown` failures are always non-fatal.
 */
export class PluginLifecycleRunner {
  constructor(private readonly host: LifecycleHost) {}

  /** Run `init` on every enabled plugin in topological order. */
  public async runInit(): Promise<void> {
    await this.runPhase('init', async (entry, ctx) => {
      if (entry.plugin.init !== undefined) {
        await entry.plugin.init(ctx as PluginInitContext<unknown>);
      }
    });
  }

  /**
   * Run `start` on every enabled plugin in topological order, then
   * attach every enabled plugin's event subscriptions to the host's
   * event dispatcher.
   */
  public async runStart(): Promise<void> {
    await this.runPhase('start', async (entry, ctx) => {
      if (entry.plugin.start !== undefined) {
        await entry.plugin.start(ctx as PluginStartContext);
      }
    });
    this.attachEventSubscriptions();
  }

  /** Run `onReady` on every enabled plugin in topological order. */
  public async runReady(): Promise<void> {
    await this.runPhase('onReady', async (entry, ctx) => {
      if (entry.plugin.onReady !== undefined) {
        await entry.plugin.onReady(ctx as PluginRuntimeContext);
      }
    });
  }

  /**
   * Run `onShutdown` in reverse topological order. Failures are always
   * non-fatal — the bot is shutting down regardless. Event
   * subscriptions are detached for every enabled plugin.
   */
  public async runShutdown(): Promise<void> {
    const reverse = [...this.host.order].reverse();
    for (const id of reverse) {
      if (this.host.disabled.has(id)) continue;
      const entry = this.host.registered.get(id);
      if (entry === undefined) continue;
      if (entry.plugin.onShutdown !== undefined) {
        try {
          await entry.plugin.onShutdown(this.buildRuntimeContext(entry));
        } catch (err: unknown) {
          this.host.logger.warn(
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
      this.host.dispatcher.unsubscribeAll(id);
    }
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private async runPhase(
    phase: 'init' | 'start' | 'onReady',
    invoke: (
      entry: RegisteredPlugin,
      ctx: PluginInitContext<unknown> | PluginRuntimeContext,
    ) => Promise<void>,
  ): Promise<void> {
    const criticalFailures: CriticalPluginFailureError[] = [];
    for (const id of this.host.order) {
      if (this.host.disabled.has(id)) continue;
      const entry = this.host.registered.get(id);
      if (entry === undefined) continue;
      try {
        const ctx =
          phase === 'init' ? this.buildInitContext(entry) : this.buildRuntimeContext(entry);
        await invoke(entry, ctx);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.host.disabled.set(id, { id, phase, error });
        this.host.logger.error(
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
        // Cascade-disable every plugin that (transitively) depended on
        // this one — their lifecycle hooks would observe a partly
        // initialised world otherwise.
        const cascaded = cascadeDisable(
          id,
          phase,
          error,
          this.host.dependents,
          this.host.registered,
          {
            isDisabled: (victim) => this.host.disabled.has(victim),
            disable: (victim, descriptor) => this.host.disabled.set(victim, descriptor),
            onVictim: (victim, rootCause) => {
              this.host.logger.warn(
                {
                  plugin: victim,
                  phase,
                  dependency: id,
                  cause: { message: rootCause.message },
                },
                'plugin disabled because its dependency failed; lifecycle hook will not run',
              );
            },
          },
        );
        criticalFailures.push(...cascaded);
      }
    }
    if (criticalFailures.length > 0) {
      // Surface the first critical failure (preserving cause). The
      // remaining critical failures stay visible in disabledPlugins.
      throw criticalFailures[0];
    }
  }

  private attachEventSubscriptions(): void {
    for (const id of this.host.order) {
      if (this.host.disabled.has(id)) continue;
      const entry = this.host.registered.get(id);
      if (entry === undefined) continue;
      const subs: PluginEventSubscriptions | undefined = entry.plugin.events;
      if (subs === undefined) continue;
      this.host.dispatcher.subscribe(id, this.buildRuntimeServices(entry), subs);
    }
  }

  private buildRuntimeServices(entry: RegisteredPlugin): PluginRuntimeServices {
    return Object.freeze({
      logger: this.host.logger.child({ plugin: entry.plugin.id }),
      translator: this.host.translator,
      clock: this.host.clock,
      resolve: this.host.resolve,
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
}
