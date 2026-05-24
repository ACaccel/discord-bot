# C5 — Infra Adapters

## Responsibility

Isolates third-party SDKs behind typed adapters so the rest of the codebase depends only on stable interfaces. Three families: Mongo connections, LLM providers, and small Discord-side adapters.

## Mongo

`src/infra/mongo/connection-manager.ts` exposes `ConnectionManager` with two implementations: `MongoConnectionManager` (real Mongoose) and `StaticConnectionManager` (test injection).

- `getConnection(guildId)` opens or returns the cached connection for a guild.
- Failure classification reuses `isTransient(error)` from `src/persistence/error-translator.ts` (`DATABASE_TIMEOUT` / `DATABASE_NETWORK` are transient, others persistent).
- Transient failures retry with bounded exponential backoff via `RetryPolicy` (default: 3 attempts, 200 ms initial, 2 s cap; injectable through the constructor).
- When retries are exhausted or a persistent error occurs, the manager marks the `guildId` disabled with a generated `traceId` and logs one operator-level line.
- `isDisabled(guildId): DisabledGuildState | undefined` exposes the disabled state (`traceId` plus the classified `DatabaseError`) for handlers and BaseBot to read; subsequent `getConnection` calls short-circuit with the same error. `close` / `closeAll` clear the marker.
- Bots sharing the same base URI share one disabled set (one physical database, one failure).

## LLM

`src/infra/llm/` implements the Provider Strategy:

- `types.ts` — `LlmProvider` interface plus shared request/response shapes.
- `openai-provider.ts`, `anthropic-provider.ts`, `gemini-provider.ts`, `xai-provider.ts` — concrete `LlmProvider` implementations.
- `registry.ts` / `default-registry.ts` — provider registry assembly.
- `llm-service.ts` — facade used by the `llm-chat` plugin.
- `models-catalog.ts` — `ModelCatalog` (pure cache plus API-key map). Registered via `ctx.registerInstance(TOKENS.ModelCatalog, ...)` inside `LlmChatPlugin.init`; consumed by handlers through `bot.modelCatalog?.list(provider)`.
- `error-translator.ts` — translates provider errors to `LlmProviderError`.
- `pricing.ts` — token-cost lookup table.

## Discord adapters

`src/infra/discord/`:

- `attachment-archive.ts` — uploads message attachments to an archive channel for backup workflows.
- `channel-log.ts` — operator log channel adapter.

## Notes

`@core/*` modules never import from `src/infra/`. The dependency direction is one-way: composition roots and adapters depend on core, never the reverse.
