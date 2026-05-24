# C11 — Bot Composition Roots

## Responsibility

The only wiring layer. `BaseBot` owns the lifecycle; each personality picks its plugins and middlewares; `src/deploy.ts` handles slash-command registration. Composition roots are the only place that may import directly from `@core/ioc`.

## `BaseBot` and collaborators

`src/bot/index.ts` keeps `BaseBot` as a thin lifecycle owner. `run()` orchestrates four collaborators in order: set up the container, set up the translator, connect every guild's DB, register every guild, attach the client event bridge, then start the plugin host.

- `src/bot/guild-registrar.ts` — `GuildRegistrar` assembles `GuildInfo` from Discord guild objects. Pure assembly; opens no Mongo connection and sends no Discord traffic.
- `src/bot/client-event-bridge.ts` — `ClientEventBridge` adapts raw `client.on(...)` events into router dispatch, `EventDispatcher` emits, and `ReactionHandlerPort` calls. Single `attach` / `detach` entry; attaching twice throws `TypeError` as a contract violation.
- `src/bot/guild-db-connector.ts` — `GuildDbConnector` fans out per-guild Mongo connections. `connectAll` is resilient: a single guild's failure is logged but does not abort the others.
- `src/bot/guild-onboarding.ts` — `BaseBotGuildOnboardingPort` adapts `BaseBot` to `GuildOnboardingPort` (registered as `TOKENS.GuildOnboardingPort`) so the `guild-events` plugin can drive new-guild onboarding without depending on `BaseBot` directly.
- `src/bot/locales-dir.ts` — `resolveLocalesDir()` helper. The composition root owns the locales path and injects it into `BaseBot` via the constructor; the core i18n layer no longer guesses it from `__dirname`.
- `src/bot/middlewares.ts` — shared router middlewares (request-scoped `traceId`, structured-log binding).

Subclasses override the protected `eventBridgeSuppression()` hook to opt out of raw listeners they do not need (e.g. `konata`, `msg-archive`). `BaseBot.login` rejects with `ConfigurationError` (`BOT_LOGIN_FAILED` / `BOT_LOGIN_NO_USER`) on failure; `run()` never proceeds with a half-attached client.

## Optional plugin singletons

`bot.voice` and `bot.modelCatalog` are getters backed by `container.tryResolve(TOKENS.VoiceController)` and `container.tryResolve(TOKENS.ModelCatalog)`. Bots that do not load the registering plugin (for example `msg-archive`) naturally observe `undefined`. Handler-level disabled-guild checks read `bot.connectionManager.isDisabled(...)` rather than any `BaseBot`-owned map.

## Personalities

- `src/bot/nijika/` — web-facing. Loads `createEarthquakePlugin({ port })`, which owns the Express `/discord/earthquake` route and per-guild broadcast.
- `src/bot/konata/` — interactive personality.
- `src/bot/tomori/` — interactive personality.
- `src/bot/msg-archive/` — worker-style. Suppresses interaction / reaction / `guildCreate` listeners via `eventBridgeSuppression()` and runs `MessageBackupPlugin`. Logs go to `logs/msg-archive-<guildId>.log`.

## Deploy

`src/deploy.ts` is the slash-command registration entry point. It uses the same `resolveLocalesDir()` helper as `BaseBot` to inject the locales path and emits structured pino through `createBootstrapLogger`.
