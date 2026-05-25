# C1 — Core Infrastructure

## Responsibility

The lowest layer of the architecture: pure infrastructure with no Discord, no Mongoose, and no business logic. Provides cross-cutting primitives consumed by every other layer.

## Key files

- `src/core/config/` — zod-parsed `Env` and `createBootstrapLogger` for early-startup structured logs.
- `src/core/errors/` — `DomainError` tree (`ValidationError`, `NotFoundError`, `ConflictError`, `PermissionError`, `ExternalServiceError` and its `DiscordApiError` / `DatabaseError` / `LlmProviderError` subclasses, `ConfigurationError`). Each carries `code`, `messageKey`, `messageParams`, and `cause`.
- `src/core/result/` — `Result<T, E>` with `ok` / `err` helpers; used at use-case and repository boundaries.
- `src/core/i18n/` — `I18NextTranslator`, `loadCatalogResources`, and the `LoadCatalogOptions` contract (`localesDir` is required; the core layer never derives the content path itself).
- `src/core/logger/` — structured logger plus PII redaction helpers.
- `src/core/time/` — injectable `Clock` for deterministic time access in tests.
- `src/core/ids.ts` — branded ID types (`GuildId`, `UserId`, etc.).
- `src/core/guild-registry.ts` — per-guild channel / role / repo lookup interface.
- `src/core/scheduling/` — `JobManager` (wraps `node-schedule`) and `parseDuration`; shared by giveaway and activity plugins via `@core/scheduling`.

## Notes

Nothing in `src/core/` may import from `src/infra/`, `src/persistence/`, `src/handlers/`, `src/plugins/`, or `src/bot/`. The layer stays free of third-party SDKs apart from a small set of leaf libraries (`i18next`, `pino`, `node-schedule`, `zod`).
