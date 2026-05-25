# Wiki Changelog

Wiki-level changelog. Each entry corresponds to a release of the bot
and summarises the structural changes that landed in the
component pages.

For the user-facing release notes see [`CHANGELOG.md`](../../CHANGELOG.md)
at the repository root.

---

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
