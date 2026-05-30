# Wiki Changelog

Wiki-level changelog. Each entry corresponds to a release of the bot
and summarises the structural changes that landed in the
component pages.

For the user-facing release notes see [`CHANGELOG.md`](../../CHANGELOG.md)
at the repository root.

---

## Unreleased

- **C8 Plugins / C5 Infra / C11 Bot** — new `llm-auto-reply` plugin
  (nijika): a probability-gated `messageCreate` subscriber that, on a
  hit, fetches the latest N messages, requires they form a burst within
  a window, builds a transcript (bot/blank lines dropped), and posts one
  self-hosted-LLM reply with mentions suppressed. The outbound call is a
  new `SelfHostedLlmClient` adapter in `src/infra/llm/` (does not
  implement `LLMProvider`; maps failures into the shared
  `ExternalServiceError` taxonomy). Settings come from an optional,
  fully-code-defaulted `llm_auto_reply` config block; `blocked_channels`
  are excluded. A per-channel `cooldownSeconds` (`internal/cooldown.ts`,
  `ReplyCooldown`) enforces a minimum gap between consecutive automatic
  replies. A `fatcat_reply` force-trigger keyword (`internal/trigger.ts`)
  bypasses the probability roll, the time-window burst check, and the
  cooldown while still honouring the message-count requirement and the
  other guards, and is stripped from the prompt transcript; every posted
  reply records the cooldown. C8 plugin list
  grows to nine; C5, C11 component pages and `nijika`'s
  `config.example.json` updated.

- **C11 Bot / C1 Core / C6 Handlers** — two fixes. (1) `yarn deploy`
  no longer crashes / writes logs: `createBootstrapLogger` gained a
  `fileRouter` option and `src/deploy.ts` builds a console-only logger
  via `{ fileRouter: false }`, so the file-router `bot`-binding
  requirement no longer applies to the one-shot CLI and no
  `logs/<botId>/` tree is created. (2) Bot admins are now a list:
  `Config.admin` is `string[]`, `BaseBot` exposes `adminIds` +
  `isAdmin(userId)`, the `/ai_whitelist_*` handlers gate on `isAdmin`,
  and `/bug_report` DMs every configured admin. C1 / C11 component
  pages updated; all four bundled configs set `admin` to a string list.

- **C11 Bot / C7 i18n** — `src/deploy.ts` now localises registered
  command descriptions to the bot's `config.language` (via
  `buildDeployTranslator`, mirroring `BaseBot.buildHost`); previously it
  always registered `zh-TW`. A new `--dry-run` flag prints the resolved
  command text without touching Discord, to verify locale output ahead
  of a propagation-delayed global deploy. The default global deploy also
  **prunes guild-scoped commands** (`clearAllGuildCommands`) so a stale
  guild-scoped registration cannot override the global set in a guild;
  `--keep-guild-commands` skips the prune. The guild list is fetched with
  `fetchAllUserGuilds` (`src/deploy-guilds.ts`), which paginates Discord's
  200-per-page `after` cursor so bots in >200 guilds are fully covered
  (a single `userGuilds` call would silently truncate). C7 / C11 pages
  note the deploy localisation path and the guild-prune step.

- **C11 Bot / C7 i18n / C6 Handlers** — three config-driven features.
  (1) A per-bot `language` field in `config.json` (`'zh-TW'` | `'en'`)
  drives the translator's default locale via `isLocale` +
  `createDefaultTranslator({ fallbackLocale })`; `SUPPORTED_LOCALES` /
  `isLocale` were added to `src/core/i18n/translator.ts`. (2)
  `guilds.<id>.channels` / `roles` became optional in `Config` —
  `GuildRegistrar` already tolerated missing maps, so omitting them
  disables channel-bound side effects (debug log, event mirror) while
  keeping every other feature; `tomori` ships with no `guilds` block.
  (3) `/help` was rebuilt as a public categorized embed driven by a new
  `CommandConfig.category` union; the pure builder lives at
  `src/handlers/commands/help/build-help-embed.ts` (unit-tested under
  `test/unit/handlers/help/`), all command handlers are tagged, and new
  `replies:help.*` keys (`title`, `intro_fallback`, `footer`,
  `category.<key>`) plus `replies:tomori.help_message` landed in both
  locales. C6 / C7 / C11 component pages updated accordingly.

- **C11 Bot / C8 Plugins** — the `tomori` personality now registers
  `createGuildEventsPlugin(...)` (it previously only loaded auto-reply / giveaway /
  activity / voice), so `messageUpdate` / `messageDelete` / `guildMemberUpdate` /
  `guildCreate` are again subscribed and their `logGuildEvent` audit lines (and the
  `event`-channel mirror, once configured) are produced. A new
  `test/unit/bot/tomori-composition.test.ts` pins each personality's plugin set so
  the drift cannot recur silently. The `giveaway` plugin was redesigned: it no longer
  requires a dedicated `giveaway` channel — `/giveaway_create` publishes the
  announcement in the channel it was invoked from and removes its own interaction
  reply. The orphaned `replies:giveaway.channel_not_configured` and
  `replies:giveaway.create_success` keys were dropped from both locales. The C8
  `guild-events` description was corrected to list all four subscriptions (it
  previously named only `guildCreate`).

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
