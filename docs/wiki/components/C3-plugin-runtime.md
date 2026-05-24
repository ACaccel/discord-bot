# C3 — Plugin Runtime

## Responsibility

The plugin micro-kernel. Defines the `Plugin<Config>` contract and drives plugin lifecycle, event dispatch, and interaction routing. Plugins describe themselves declaratively; the runtime decides when to call them.

## The `Plugin<Config>` contract

Defined in `src/core/plugin/types.ts`. Each plugin declares:

- `id` (stable string), SemVer `version`, `scope` (`'bot'` or `'guild'`), optional `critical` flag, optional dependency list.
- Optional zod `configSchema` validated on load.
- Lifecycle hooks: `init`, `start`, `ready`, `shutdown`.
- `events` — subscriptions to dispatcher events (e.g. `events.guildCreate`).
- `contributes` — commands, buttons, modals, select-menus, reactions, jobs, and locale namespaces the plugin adds to the bot.

Plugins call `ctx.resolve(TOKENS.X)` to read dependencies. During `init` only, they may call `ctx.registerInstance(token, instance)` to publish a singleton; the type system hides that method from `start` / runtime / event contexts.

## Key files

- `src/core/plugin/types.ts` — `Plugin<Config>`, lifecycle context types, contribution shapes.
- `src/core/plugin/index.ts` — public barrel. Re-exports `TOKENS` (value) plus `ServiceToken` and `Resolver` (types) so plugins never need to reach into `@core/ioc`. The container constructors and error types are intentionally not re-exported.
- `src/core/plugin/host.ts` — `PluginHost`: thin delegation surface (`initAll`, `startAll`, `readyAll`, `shutdownAll`).
- `src/core/plugin/host/lifecycle.ts` — `PluginLifecycleRunner`. Tracks the current phase (`'idle' | 'init' | 'start' | 'ready' | 'running' | 'shutdown'`) and rejects `registerInstance` calls outside `init` with `ConfigurationError(code: 'LIFECYCLE_PHASE_VIOLATION')`.
- `src/core/plugin/host/topology.ts` — `cascadeDisable` pure function for dependency-aware disable propagation.
- `src/core/plugin/dispatcher.ts` — `EventDispatcher` for plugin-to-plugin and Discord-event fan-out.
- `src/core/plugin/router.ts` — `InteractionRouter` matching Discord interactions to plugin contributions.
- `src/core/plugin/guild-onboarding-port.ts` — `GuildOnboardingPort` interface: connect a new guild's DB and register its commands. Implemented by `BaseBot`, consumed by the `guild-events` plugin.

## Notes

`LifecycleHost` (the runner's inward-facing interface) exposes exactly one writable surface — `container: ServiceContainer` — through which `registerInstance` is implemented. Plugins themselves only see the typed-token resolver and the `registerInstance` facade.
