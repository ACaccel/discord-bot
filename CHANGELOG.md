# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Per-bot display language: a `language` field in each personality's
  `config.json` (`"zh-TW"` | `"en"`) selects the translator's default
  locale, validated by `isLocale` and threaded into
  `createDefaultTranslator({ fallbackLocale })`; an unsupported value
  warns and falls back to `zh-TW`. Applied both at runtime
  (`BaseBot.buildHost`) and by `src/deploy.ts`, so registered
  slash-command descriptions match the bot's configured locale. All
  four bundled bots set `"language": "zh-TW"` explicitly.
- Optional channel configuration: `guilds.<id>.channels` and `roles`
  are now optional in `config.json`. A bot may omit them (or the whole
  `guilds` block) and keeps every feature while silently skipping
  channel-bound side effects (debug logging, the guild-event mirror).
  `tomori` runs with no `guilds` block.
- Redesigned `/help`: a public categorized embed grouped by a new
  `CommandConfig.category` field (rendered by the unit-tested pure
  builder `src/handlers/commands/help/build-help-embed.ts`), with bot
  name / avatar in the author line and command / category counts in the
  footer. Every command handler is tagged with a category; `tomori`
  gained a `helpMessageKey` intro.
- File-router pino transport (`src/core/logger/file-router-transport.ts`)
  that writes JSON Lines to `<rootDir>/<botId>[/<guildId>]/<localDate>.log`,
  rotating on the local-time day boundary. Enabled by default via the
  `LOG_DIR` environment variable (defaults to `logs`).
- Structured `details` payload on `logGuildEvent` so every Discord
  event audit line carries per-field structured data (`command`,
  `user`, `channel`, `oldMessage`, `newMessage`, `added`, `removed`,
  `messageId`, `emoji`, ...) for `jq` / log-search consumers instead
  of pre-flattened strings.
- `GUILD_CREATE` audit line, promoted from `logSystem` to
  `logGuildEvent` so onboarding events file under the per-guild
  directory instead of the bot root.
- Standalone ops tools under `tools/`: `msg_backup` (backs up a guild's
  message history to a single human-readable transcript) and `verify_db`
  (scans a guild's backup database for integrity problems). Each ships
  pure, unit-tested internals plus operator docs under
  `docs/wiki/ops/`.
- `tools` vitest project plus a `test:tools` script and a `test-tools`
  CI job, so the ops-tool unit tests gate merges; the prettier glob and
  strict-tsconfig include now cover `tools/**`.
- `DefaultModelResolver` (`src/infra/llm/default-model-resolver.ts`):
  keeps each provider's default chat model pointed at the cheapest model
  still listed by the provider, published by `LlmChatPlugin.init` and
  refreshed weekly via the new `JobManager.scheduleRecurring`, so a
  retired model never strands a whitelist-entry default.
- Timestamped per-run backup transcript paths
  (`logs/backup/msg-archive-<guildId>-<YYYY-MM-DD_HH-MM-SS>.log`) so a
  truncating reopen no longer overwrites the prior run's artifact;
  `msg-archive` gains an optional `backup_interval_minutes` config.
- Git Flow branching model (long-lived `main` + `dev`), documented in
  `CONTRIBUTING.md` and `CLAUDE.md`; CI and CodeQL triggers now cover
  `dev`. Routine work is committed directly to `dev` (the local gate
  suite is the discipline; the `dev` push CI is a post-push signal, not a
  merge gate); PRs are reserved for `dev` → `main` releases, hotfixes,
  and optional large / risky `feature/*` work. Only `main` enforces the
  full required CI gate set.

### Changed

- File-router transport now strips the `bot` field from each JSON
  record before writing. The parent directory (`logs/<bot>/...`)
  already names the owning bot, so the in-record `bot` field was dead
  weight that bloated disk usage and `jq` output. `guildId` stays in
  the record — downstream aggregators (cross-guild dashboards,
  archival pipelines) need it as a join key when the file path is not
  available.
- `logSystem` / `logError` / `logGuildEvent` no longer take a
  `clientId` parameter and no longer re-bind `{ bot: clientId }` on
  every call. `createBootstrapLogger` attaches `{ bot }` via pino's
  `base` so the binding is ambient on every child; the duplicate
  binding the helpers produced caused two `bot` fields per JSON line.
  Every callsite is updated to the new shape.
- `createLogger` no longer builds the file-router transport. The sink
  is now exposed via a separate `createFileSink({ rootDir, level })`
  factory in `src/core/logger/file-router-transport.ts` and wired in
  by `createBootstrapLogger` via the new `extraStreams` option, so
  `core/logger/logger.ts` is free of file-system concerns. Tests build
  loggers via plain `createLogger` (no `extraStreams`) and therefore
  never open files, removing the prior `NODE_ENV === 'test'` branch
  inside `createBootstrapLogger`.
- `logSystem` now passes `msg` as the pino headline (positional
  argument) rather than under a `msg` binding, fixing a
  `messageKey` collision that silently dropped the operator-supplied
  text in pretty output.
- `pino-pretty` configuration: time format trimmed to seconds
  (`SYS:HH:MM:ss`) and the always-bound `bot` / `guildId` /
  `eventType` fields are hidden in the dev console (they remain in the
  JSON file sink). Closes the gap that made dev terminal output
  unreadable.
- Bot admins are now a list: `Config.admin` is `string[]` (was a single
  `string`) and `BaseBot` exposes `adminIds` plus an `isAdmin(userId)`
  check. `/ai_whitelist_add` / `/ai_whitelist_remove` gate on
  `isAdmin`, and `/bug_report` DMs every configured admin (best-effort)
  rather than only the first. Snowflake ids must be JSON strings.

### Removed

- Internal `docs/proposal.md` and `docs/tasks/` working-document
  artifacts. The gap-remediation work they tracked has shipped.
- `_unbound/` fallback bucket from the file-router transport. The
  composition root attaches `{ bot: clientId }` on the root logger so
  every record carries `bot` by construction; a missing binding is now
  a contract violation that surfaces as an error on the Writable
  stream instead of silently landing in a junk directory.
- `MESSAGE_CREATE` audit lines from `auto-reply` and `llm-chat`. These
  events sit on the hot path of normal use (every plugin reply would
  produce a log line) and operator feedback was that the volume drowned
  every other event without adding signal. `MESSAGE_CREATE` now joins
  reactions as an intentionally un-audited event type; the plugin reply
  behaviour itself is unchanged.

### Fixed

- `yarn deploy` crashed (exit 1) right after registering commands: the
  file-router log transport rejects records without a `bot` binding,
  which the deploy CLI's bootstrap logger lacked. Deploy now builds its
  logger with `createBootstrapLogger(base, { fileRouter: false })` —
  console-only — so it runs to completion and no longer creates a
  `logs/<botId>/` directory. The new `fileRouter` option on
  `createBootstrapLogger` (default `true`) is the opt-out.

## [1.0.0] — 2026-05-25

Initial public release.

### Added

- Layered architecture (`core` → `persistence` / `infra` → `handlers` / `plugins` → `bot`) with the dependency direction enforced by ESLint.
- Plugin system with a topologically-ordered four-phase lifecycle (`init`, `start`, `onReady`, `onShutdown`) and zod-validated config.
- Typed manual IoC container with a central `TOKENS` directory. Plugins reach `TOKENS` only through the `@core/plugin` barrel.
- Repository pattern over Mongoose, with `buildRepos(connection)` returning per-guild repository bundles.
- LLM provider Strategy layer covering OpenAI, Anthropic, Gemini, and xAI.
- Process-wide `MongoConnectionManager` with per-guild lifecycle, exponential-backoff retry, and a disabled-set so one guild's outage does not stop the bot.
- Slash-command codegen (`scripts/gen-registry.ts`) with a CI drift check.
- Bilingual i18n catalogs (`zh-TW`, `en`) split into `commands`, `errors`, and `replies` namespaces, with a parity check and a CJK-literal scanner.
- Strict TypeScript across the whole `src/`.
- Structured logging with redaction.
- Four built-in personalities: `nijika`, `konata`, `tomori`, `msg-archive`.
- Eight built-in plugins: `auto-reply`, `llm-chat`, `message-backup`, `giveaway`, `activity`, `guild-events`, `voice`, `earthquake`.
- Pre-deploy `yarn smoke` boundary probe (env load, Mongo ping, Discord login).
- Quality gates: `typecheck`, `typecheck:emit`, `lint`, `format:check`, `handlers:gen:check`, `test:unit`, `test:int`, `test:contract`, `test:i18n`, `knip`, `security`.
- Read-only public `BaseBot.guildInfo` API surface (accessor methods + readonly views).

### Documentation

- `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` rewritten for public contributors.
- New `docs/architecture.md` single-page architecture overview.
- `SECURITY.md` (GitHub Security Advisory workflow, 72-hour response, 90-day disclosure).
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- Repo wiki at `docs/wiki/` rewritten as a current-state component map.

[1.0.0]: https://github.com/ACaccel/discord-bot/releases/tag/v1.0.0
