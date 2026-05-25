# C1 — Core Infrastructure

## Responsibility

The lowest layer of the architecture: pure infrastructure with no Discord, no Mongoose, and no business logic. Provides cross-cutting primitives consumed by every other layer.

## Key files

- `src/core/config/` — zod-parsed `Env` and `createBootstrapLogger` for early-startup structured logs.
- `src/core/errors/` — `DomainError` tree (`ValidationError`, `NotFoundError`, `ConflictError`, `PermissionError`, `ExternalServiceError` and its `DiscordApiError` / `DatabaseError` / `LlmProviderError` subclasses, `ConfigurationError`). Each carries `code`, `messageKey`, `messageParams`, and `cause`.
- `src/core/result/` — `Result<T, E>` with `ok` / `err` helpers; used at use-case and repository boundaries.
- `src/core/i18n/` — `I18NextTranslator`, `loadCatalogResources`, and the `LoadCatalogOptions` contract (`localesDir` is required; the core layer never derives the content path itself).
- `src/core/logger/` — structured logger plus PII redaction helpers. `createLogger(input)` only builds the pino instance plus optional pretty console; the project-local `file-router-transport` (writes JSON Lines to `<rootDir>/<botId>[/<guildId>]/<localDate>.log`, rotating on the local-time day boundary) is exposed via the opt-in `createFileSink` factory and wired in by `createBootstrapLogger` (the composition-root logger factory in `src/core/config/bootstrap-logger.ts`). Tests that just need a logger call `createLogger` directly with no `extraStreams`, so unit suites never touch the filesystem. Records reaching the file sink MUST carry the `bot` binding — the composition root attaches `{ bot: clientId }` on the root logger, and a missing binding surfaces as a `Writable` error event rather than landing in a junk fallback directory. `bot` is path-encoded only: the routing step extracts it to pick the file path and then strips it from the JSON record before serialising, so each line under `logs/<bot>/...` does not re-state the bot id. `guildId` is left in the record so cross-guild aggregators can join on it without seeing the file path. `logSystem` / `logGuildEvent` / `logError` helpers in `helpers.ts` are the canonical handler-side logging API; `logGuildEvent` takes a structured `details` object so every event-specific field stays grep- and `jq`-queryable. Reaction events and `MESSAGE_CREATE` are intentionally not audit-logged (per-guild throughput on the hot reply path would drown every other event); plugin reply behaviour itself is unaffected.
- `src/core/time/` — injectable `Clock` for deterministic time access in tests.
- `src/core/ids.ts` — branded ID types (`GuildId`, `UserId`, etc.).
- `src/core/guild-registry.ts` — per-guild channel / role / repo lookup interface.
- `src/core/scheduling/` — `JobManager` (wraps `node-schedule`) and `parseDuration`; shared by giveaway and activity plugins via `@core/scheduling`.

## Notes

Nothing in `src/core/` may import from `src/infra/`, `src/persistence/`, `src/handlers/`, `src/plugins/`, or `src/bot/`. The layer stays free of third-party SDKs apart from a small set of leaf libraries (`i18next`, `pino`, `node-schedule`, `zod`).
