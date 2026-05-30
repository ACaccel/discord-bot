# C11 — Bot Composition Roots

## Responsibility

The only wiring layer. `BaseBot` owns the lifecycle; each personality picks its plugins and middlewares; `src/deploy.ts` handles slash-command registration. Composition roots are the only place that may import directly from `@core/ioc`.

## `BaseBot` and collaborators

`src/bot/index.ts` keeps `BaseBot` as a thin lifecycle owner. `run()` orchestrates four collaborators in order: set up the container, set up the translator (in the bot's configured `language`, see below), connect every guild's DB, register every guild, attach the client event bridge, then start the plugin host.

- `src/bot/guild-registrar.ts` — `GuildRegistrar` assembles `GuildInfo` from Discord guild objects. Pure assembly; opens no Mongo connection and sends no Discord traffic.
- `src/bot/client-event-bridge.ts` — `ClientEventBridge` adapts raw `client.on(...)` events into router dispatch, `EventDispatcher` emits, and `ReactionHandlerPort` calls. Single `attach` / `detach` entry; attaching twice throws `TypeError` as a contract violation.
- `src/bot/guild-db-connector.ts` — `GuildDbConnector` fans out per-guild Mongo connections. `connectAll` is resilient: a single guild's failure is logged but does not abort the others.
- `src/bot/guild-onboarding.ts` — `BaseBotGuildOnboardingPort` adapts `BaseBot` to `GuildOnboardingPort` (registered as `TOKENS.GuildOnboardingPort`) so the `guild-events` plugin can drive new-guild onboarding without depending on `BaseBot` directly.
- `src/bot/locales-dir.ts` — `resolveLocalesDir()` helper. The composition root owns the locales path and injects it into `BaseBot` via the constructor; the core i18n layer no longer guesses it from `__dirname`.
- `src/bot/middlewares.ts` — shared router middlewares (request-scoped `traceId`, structured-log binding).

Subclasses override the protected `eventBridgeSuppression()` hook to opt out of raw listeners they do not need (e.g. `konata`, `msg-archive`). `BaseBot.login` rejects with `ConfigurationError` (`BOT_LOGIN_FAILED` / `BOT_LOGIN_NO_USER`) on failure; `run()` never proceeds with a half-attached client. On success it emits one `ops:bot.online` system line naming the bot's Discord `displayName`, giving operators a per-personality "who am I" marker at startup.

## Optional plugin singletons

`bot.voice`, `bot.modelCatalog`, and `bot.defaultModelResolver` are getters backed by `container.tryResolve(TOKENS.VoiceController)`, `container.tryResolve(TOKENS.ModelCatalog)`, and `container.tryResolve(TOKENS.DefaultModelResolver)`. Bots that do not load the registering plugin (for example `msg-archive`) naturally observe `undefined`. Handler-level disabled-guild checks read `bot.connectionManager.isDisabled(...)` rather than any `BaseBot`-owned map.

## Personalities

- `src/bot/nijika/` — web-facing. Loads `createEarthquakePlugin({ port })`, which owns the Express `/discord/earthquake` route and per-guild broadcast.
- `src/bot/konata/` — interactive personality.
- `src/bot/tomori/` — interactive personality.
- `src/bot/msg-archive/` — worker-style. Suppresses interaction / reaction / `guildCreate` listeners via `eventBridgeSuppression()` and runs `MessageBackupPlugin`. Backup transcripts go to `logs/backup/msg-archive-<guildId>-<YYYY-MM-DD_HH-MM-SS>.log` (one timestamped file per run, so reruns never overwrite a prior transcript). Its `config.json` carries an optional `backup_interval_minutes` (defaults to 60); the root converts it to the plugin's `backupIntervalMs`.

## Bot `config.json`

Each personality loads a sibling `config.json` (`import config from './config.json'`) and passes it to its constructor; the shape is `Config` in `src/bot/index.ts` plus any per-personality extension. There is no runtime schema validation — the composition root trusts its own file — but several fields have deliberate semantics:

- `admin` — optional `string[]` of Discord user ids granted bot-admin privileges. The constructor copies it into `BaseBot.adminIds` (default `[]`); `bot.isAdmin(userId)` is the single membership check the admin-gated handlers (`/ai_whitelist_*`) use, and `/bug_report` DMs every id in the list. Snowflake ids exceed JS's safe-integer range, so they must be JSON strings.
- `language` — optional default display locale (`'zh-TW'` | `'en'`; omit for the framework default `zh-TW`). `BaseBot.buildHost` validates it with `isLocale` and passes it to `createDefaultTranslator({ fallbackLocale })`; an unsupported value logs a warning and falls back to the default. All four bundled bots set `"language": "zh-TW"` explicitly.
- `guilds.<id>.channels` and `guilds.<id>.roles` — both optional. A guild may omit either map, or omit its whole `guilds` entry. `GuildRegistrar` resolves a missing map to `{}` and drops ids that are not in the live cache, so the bot keeps every feature but silently skips channel-bound side effects (the `debug` interaction log and the `guild-events` mirror have nothing to send to). `tomori` runs this way — its `config.json` has no `guilds` block at all. (`msg-archive` is the exception: `MessageBackupPlugin` requires a `debug` channel and aborts a backup pass without one — by design.)

## Deploy

`src/deploy.ts` is the slash-command registration entry point. It uses the same `resolveLocalesDir()` helper as `BaseBot` to inject the locales path and emits structured pino through `createBootstrapLogger({ component: 'deploy' }, { fileRouter: false })` — console-only. As a one-shot CLI it has no `bot` binding (which the file router requires) and must not create a `logs/<botId>/` tree, so it opts out of the file sink.

Command descriptions are localised to the bot's `config.language` via `buildDeployTranslator` (same `fallbackLocale` plumbing as `BaseBot.buildHost`), so a bot's registered slash-command text matches its runtime locale. The `--dry-run` flag builds and prints the resolved command name/description without registering, which isolates code behaviour from Discord's global-command propagation delay (up to ~1h) and stale guild-scoped registrations (cleared with `--cleanup-guild-commands`).
