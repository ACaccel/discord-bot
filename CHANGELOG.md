# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
