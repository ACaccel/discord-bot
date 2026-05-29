# Wiki Changelog

Wiki-level changelog. Each entry corresponds to a release of the bot
and summarises the structural changes that landed in the
component pages.

For the user-facing release notes see [`CHANGELOG.md`](../../CHANGELOG.md)
at the repository root.

---

## Unreleased

- **C8 Plugins / C11 Bot / C1 Core** — msg-archive backup transcripts now
  land under `logs/backup/msg-archive-<guildId>-<YYYY-MM-DD_HH-MM-SS>.log`; the
  local-time stamp (built by `buildBackupLogPath` in
  `src/plugins/message-backup/internal/log-path.ts`) keeps every run's transcript
  instead of overwriting a fixed filename. On a successful login `BaseBot.login`
  now emits one `ops:bot.online | <displayName> is online.` system line (new
  `ops.bot.online` template) so each personality announces its Discord name at
  startup.

- **C5 Infra Adapters / C8 Plugins / C2 IoC / C1 Core / C4 Persistence / C11 Bot** —
  default LLM models are now self-healing. `DEFAULT_MODELS` was reseeded to each
  provider's cheapest current chat model (xai `grok-4-1-fast-non-reasoning`,
  openai `gpt-5-nano`, anthropic `claude-haiku-4-5`, gemini `gemini-2.5-flash-lite`)
  and `DEFAULT_SETTINGS` now enables web search. A new `DefaultModelResolver`
  (`src/infra/llm/default-model-resolver.ts`, published via
  `TOKENS.DefaultModelResolver`) re-derives each provider's default as the cheapest
  still-listed priced model — `pricing.ts` gained `cheapestModel()`, `ModelCatalog`
  gained an awaited `listLive()`, and `JobManager` gained `scheduleRecurring()`.
  `LlmChatPlugin.onReady` runs an initial refresh and schedules a weekly cron
  (`0 4 * * 1`). `ai_whitelist_add` now stamps new entries with an xAI-first,
  web-search-on default (`buildWhitelistDefaults`) resolved from the live cheapest
  model; the `user-api-setting` schema defaults mirror that intent. The
  whitelist-added confirmation reply now interpolates the actual provider
  (`replies:ai_whitelist.added` gained a `{{provider}}` param) instead of a
  hard-coded `openai` literal, so the message can no longer drift from the
  written default.
- **Impact**: new whitelist users default to xAI Grok with web search on instead
  of OpenAI/GPT-4o; a provider retiring its cheapest model no longer strands the
  default on an unavailable id. `BaseBot` exposes a new `defaultModelResolver`
  getter (`undefined` for bots without LlmChatPlugin).
- **C8 Plugins** — the `message-backup` repeat cadence is now configurable.
  `MessageBackupPluginConfig` gained an optional `backupIntervalMs` (defaults
  to one hour, preserving the previous hard-coded value); the `msg-archive`
  composition root threads it from a new operator-facing
  `backup_interval_minutes` field in `config.json`.
- **C1 Core Infrastructure** — documented the file-router transport and
  the `logGuildEvent(details)` structured-details signature added in
  the logger refactor. The `logs/` tree is now per-bot / per-guild with
  local-time daily rotation; the helper file was renamed from
  `legacy.ts` to `helpers.ts` to reflect that it is the canonical
  handler-side logging API. Follow-up: split the file-router wiring out
  of `createLogger` into a separate `createFileSink` factory consumed
  by `createBootstrapLogger`, dropped the `_unbound` fallback bucket in
  favour of a hard `bot`-binding contract, and stopped audit-logging
  reaction events (too high frequency).

## v1.0.0 — Initial public release

The first publicly released revision of the wiki. The eleven
component pages (`C1`–`C11`) describe the codebase as it stands at
v1.0.0:

- **C1 Core Infrastructure** — `src/core/` (config, errors, i18n, ioc, logger, plugin, result, time, ids, guild-registry).
- **C2 IoC Container** — typed `ServiceContainer`, central `TOKENS` directory.
- **C3 Plugin Runtime** — `Plugin` contract, `PluginHost`, event dispatcher, interaction router.
- **C4 Persistence** — Mongoose Repository pattern, `buildRepos(connection)`.
- **C5 Infra Adapters** — `MongoConnectionManager`, LLM provider strategies.
- **C6 Handlers** — slash commands / buttons / modals / select menus / reactions, codegen registry, 150-line cap.
- **C7 i18n Catalog** — bilingual `zh-TW` + `en` catalogs, parity gate, CJK-literal scanner.
- **C8 Plugins** — eight built-in plugins (`auto-reply`, `llm-chat`, `message-backup`, `giveaway`, `activity`, `guild-events`, `voice`, `earthquake`).
- **C9 Codegen & Scripts** — `gen-registry.ts`, `smoke.ts`, deploy entry point.
- **C10 Quality Gates** — strict TypeScript, ESLint, Prettier, vitest projects, knip, security audit, codegen drift check.
- **C11 Bot Composition Roots** — `BaseBot` plus `GuildRegistrar`, `ClientEventBridge`, `GuildDbConnector`; four personalities.
