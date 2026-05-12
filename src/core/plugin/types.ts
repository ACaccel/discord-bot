/**
 * Plugin contract — types only.
 *
 * Production-grade plugin system foundation per plan §1.1.1–§1.1.4.
 * This file declares the interfaces and discriminants every plugin and
 * the {@link PluginHost} agree on. No runtime logic here — see
 * `host.ts`, `event-dispatcher.ts`, `interaction-router.ts`.
 *
 * Design pillars (the host enforces every one):
 *   - **id + version + dependencies** drive topological registration.
 *     Cycles or missing deps fail at register time (cheap, clearest
 *     diagnostic, lifecycle has not yet started).
 *   - **configSchema** validates via zod at register; plugins observe
 *     a 100%-typed `config` in their hooks.
 *   - **scope** declares whether one instance serves the whole bot or
 *     one per guild. Phase 4a only supports `'bot'`; `'guild'` is a
 *     type-level placeholder until Phase 4b instantiates per-guild
 *     state.
 *   - **critical** marks a plugin whose failure must abort the bot.
 *     Non-critical plugin failures get logged + the plugin enters
 *     {@link DisabledPlugin} state; the rest of the bot keeps running.
 *   - **Lifecycle hooks** are all optional `async () => void` and run
 *     in topological order: `init` -> `start` -> `onReady` ->
 *     ... runtime ... -> `onShutdown` (reverse topological order).
 *   - **events** are a typed subscription map over `discord.js`'s
 *     `ClientEvents`. The {@link EventDispatcher} fans events out with
 *     per-subscription `Promise.allSettled` isolation.
 *   - **contributes** declare command / button / modal / select-menu /
 *     reaction handlers keyed by name. The host merges plugin
 *     contributions with the codegen core registry into an effective
 *     registry, throwing on duplicate names with both source ids
 *     surfaced. See `registries.ts`.
 *
 * Service-locator guard: plugins do **not** receive the raw IoC
 * container. {@link PluginInitContext.resolve} is a typed-token
 * accessor; combined with eslint's `no-restricted-imports` blocking
 * `core/ioc` from layered code, plugins cannot bypass DI.
 */
import type { ClientEvents, Interaction } from 'discord.js';
import type { z } from 'zod';

import type { Logger } from '../logger';
import type { Translator } from '../i18n';
import type { Clock } from '../time';
import type { ServiceToken } from '../ioc';

// ---------------------------------------------------------------------------
// Identity / scoping
// ---------------------------------------------------------------------------

/** Globally unique plugin identifier. Snake-case or kebab-case by convention. */
export type PluginId = string;

/** Semver string. Major bumps for breaking contract changes. */
export type PluginVersion = string;

/**
 * One plugin's dependency on another. Phase 4a does NOT enforce
 * `versionRange` — it is captured for diagnostics + future versions.
 * The host today only validates that `id` is registered.
 */
export interface PluginDependency {
  readonly id: PluginId;
  readonly versionRange: string;
}

/**
 * `'bot'` plugins exist once per bot process; `'guild'` plugins are
 * instantiated per guild and receive a `GuildContext` (Phase 4b). The
 * 4a host throws on `'guild'` scoping until 4b lands.
 */
export type PluginScope = 'bot' | 'guild';

// ---------------------------------------------------------------------------
// Lifecycle contexts
// ---------------------------------------------------------------------------

/** Typed token-based resolve. Tighter than handing out the full container. */
export type TypedResolver = <T>(token: ServiceToken<T>) => T;

/**
 * Shared bindings every lifecycle context carries. The plugin gets a
 * pre-scoped child logger, the translator, a clock for any time math,
 * and a typed `resolve` for declared dependencies. No raw container,
 * no string-keyed lookups.
 */
export interface PluginRuntimeServices {
  readonly logger: Logger;
  readonly translator: Translator;
  readonly clock: Clock;
  readonly resolve: TypedResolver;
}

/** Context handed to `Plugin.init`. */
export interface PluginInitContext<Config> extends PluginRuntimeServices {
  /** Validated config — fully typed thanks to `configSchema`. */
  readonly config: Config;
}

/** Context handed to `Plugin.start` (Discord login done, ready event pending). */
export type PluginStartContext = PluginRuntimeServices;

/** Context handed to `Plugin.onReady` and `Plugin.onShutdown`. */
export type PluginRuntimeContext = PluginRuntimeServices;

/** Context handed to event subscriptions per dispatch. */
export interface PluginEventContext extends PluginRuntimeServices {
  /** Discord event name being dispatched. */
  readonly eventName: keyof ClientEvents;
}

// ---------------------------------------------------------------------------
// Event subscriptions (typed over discord.js ClientEvents)
// ---------------------------------------------------------------------------

/**
 * Subscription map keyed by `discord.js` event names. Each subscription
 * receives the plugin's runtime context plus the event's positional
 * arguments verbatim.
 */
export type PluginEventSubscriptions = {
  readonly [K in keyof ClientEvents]?: (
    ctx: PluginEventContext,
    ...args: ClientEvents[K]
  ) => Promise<void> | void;
};

// ---------------------------------------------------------------------------
// Contributions (handler / job / locale)
// ---------------------------------------------------------------------------

/**
 * Constructor of a per-process-singleton interaction handler. The
 * shape is intentionally loose at the core layer; concrete `Command`
 * / `ButtonHandler` / `ModalHandler` / `SSMHandler` / `ReactionHandler`
 * subclasses satisfy this implicitly.
 */
export type HandlerConstructor = new () => unknown;

/**
 * Plugin-contributed handler map keyed by handler name. The map shape
 * (rather than the plan's array shape) keeps duplicate detection
 * trivial without forcing the host to instantiate constructors just
 * to read a `config.name` field.
 */
export type ContributedRegistry = Readonly<Record<string, HandlerConstructor>>;

/** Cron / interval-scheduled background work declared by a plugin. */
export interface JobDescriptor {
  readonly name: string;
  /** Cron expression OR fixed interval ms; consumer (Phase 4b) interprets. */
  readonly schedule: string | { readonly everyMs: number };
  readonly run: (ctx: PluginRuntimeContext) => Promise<void>;
}

/** Plugin-owned i18n namespace (catalog merge happens in Phase 6). */
export interface LocaleNamespace {
  readonly namespace: string;
  readonly resources: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * Everything a plugin can add to the bot at register time. All fields
 * optional — the host accepts plugins that contribute nothing
 * (pure-listener plugins) just as readily.
 */
export interface PluginContributions {
  readonly commands?: ContributedRegistry;
  readonly buttons?: ContributedRegistry;
  readonly modals?: ContributedRegistry;
  readonly selectMenus?: ContributedRegistry;
  readonly reactions?: ContributedRegistry;
  readonly jobs?: readonly JobDescriptor[];
  readonly localeNamespaces?: readonly LocaleNamespace[];
}

// ---------------------------------------------------------------------------
// Plugin contract
// ---------------------------------------------------------------------------

export interface Plugin<Config = void> {
  readonly id: PluginId;
  readonly version: PluginVersion;
  readonly scope: PluginScope;
  readonly dependencies?: readonly PluginDependency[];
  readonly configSchema?: z.ZodType<Config>;
  /**
   * When true, a register-time or `init`/`start`-time failure terminates
   * the bot instead of marking the plugin disabled. Default `false`.
   */
  readonly critical?: boolean;

  /**
   * One-shot setup. Runs after dependency resolution succeeds and
   * before Discord login. Throw to mark this plugin disabled (or to
   * crash the bot if `critical === true`).
   */
  init?(ctx: PluginInitContext<Config>): Promise<void>;

  /**
   * Runs after Discord login succeeds but before the `ready` event
   * fires. Use to attach low-frequency listeners or register slash
   * commands. Same error semantics as `init`.
   */
  start?(ctx: PluginStartContext): Promise<void>;

  /** Runs once after the Discord `ready` event. */
  onReady?(ctx: PluginRuntimeContext): Promise<void>;

  /**
   * Runs during graceful shutdown — in **reverse** topological order,
   * so a plugin that depends on `Logger` stops before the plugin that
   * owns `Logger` does. Failure here is logged but does not block
   * other plugins' shutdown.
   */
  onShutdown?(ctx: PluginRuntimeContext): Promise<void>;

  /** Discord event subscriptions, fanned out by {@link EventDispatcher}. */
  readonly events?: PluginEventSubscriptions;

  /** Static registrations merged into the bot's effective registries. */
  readonly contributes?: PluginContributions;
}

// ---------------------------------------------------------------------------
// InteractionRouter middleware
// ---------------------------------------------------------------------------

/**
 * Context threaded through the InteractionRouter middleware chain.
 * Carries the raw Discord `Interaction` plus a request-scoped logger
 * with `traceId` already bound. Middleware is free to add fields by
 * augmenting `state`.
 */
export interface InteractionContext extends PluginRuntimeServices {
  readonly interaction: Interaction;
  /** Stable per-interaction id; child of `logger` already binds this. */
  readonly traceId: string;
  /** Mutable bag for middleware-to-middleware coordination. */
  readonly state: Map<string, unknown>;
}

/**
 * Express-style middleware. Implementations either call `next()` to
 * advance the chain or short-circuit by not calling it.
 *
 * `name` is mandatory: log lines and error traces cite it; a middleware
 * stack with anonymous functions is unobservable in production.
 */
export interface InteractionMiddleware {
  readonly name: string;
  run(ctx: InteractionContext, next: () => Promise<void>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Host-side reporting
// ---------------------------------------------------------------------------

/**
 * Reason a plugin entered the disabled set. Captures everything an
 * operator needs to triage from `/health` output or startup logs.
 */
export interface DisabledPlugin {
  readonly id: PluginId;
  /** Lifecycle phase where the failure surfaced. */
  readonly phase: 'register' | 'init' | 'start' | 'onReady';
  readonly error: Error;
}
