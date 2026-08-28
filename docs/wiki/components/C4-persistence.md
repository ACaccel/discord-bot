# C4 — Persistence

## Responsibility

Wraps MongoDB access behind the Repository pattern. Eight repositories — `activity`, `fetch`, `giveaway`, `message`, `reply`, `temp-role`, `user-api-setting`, `x-feed-cursor` — each expose an interface plus a `MongoXRepo` implementation. Consumers depend on the interface; tests inject in-memory fakes.

`user-api-setting.schema.ts` schema-level defaults are an xAI-first safety net (provider `xai`, web search on); the authoritative whitelist-entry defaults are written by the `ai_whitelist_add` handler (`buildWhitelistDefaults`), which resolves the live cheapest xAI model. Persistence may not import the infra `DEFAULT_MODELS` constant (layering), so the schema's seed model id is a static literal kept fresh at runtime by `DefaultModelResolver`.

## Key files

- `src/persistence/repositories/<x>.repo.ts` — one file per repository (`interface XRepo` + `class MongoXRepo implements XRepo`).
- `src/persistence/repositories/index.ts` — `Repos` bundle type and `buildRepos(connection)` factory that wires every `MongoXRepo` to a given guild's Mongo connection.
- `src/persistence/schemas/` — Mongoose schemas paired with TypeScript document interfaces.
- `src/persistence/error-translator.ts` — `databaseErrorFrom(error)` translates Mongoose / MongoDB driver errors into `DatabaseError` with a classified `code` (`DATABASE_TIMEOUT`, `DATABASE_NETWORK`, `DATABASE_DUPLICATE_KEY`, etc.). Also exports `isTransient(error)` used by `ConnectionManager`. This file does not import Mongoose.
- `src/persistence/index.ts` — re-exports the `XRepo` interfaces, `MongoXRepo` classes, `Repos`, `buildRepos`, and `databaseErrorFrom`.

## Error boundary

Every repository method returns `Result<T, DatabaseError>`:

- Success returns `ok(value)`. A successful lookup that finds nothing returns `ok(undefined)`.
- Mongoose errors are translated via `databaseErrorFrom` and returned as `err(databaseError)`.
- `insertManyIgnoringDuplicates` treats duplicate-key `BulkWriteError` as success (`ok`).
- Programmer errors (non-positive `limit`, malformed timestamp ranges) still throw native `TypeError` — they are bugs, not domain failures, and never enter `Result`.

Callers branch on `result.ok` and surface `DatabaseError` upward via `replyForError` (handlers) or structured logs (plugins / jobs).

## Indexes

`x-feed-cursor.schema.ts` keys documents by a unique `handle`. The guild is implicit (each guild owns its database), and `last_seen_id` is a **String** because X post ids are 64-bit and exceed `Number.MAX_SAFE_INTEGER` — storing them numerically would collapse distinct ids and break the feed's de-duplication. Comparisons go through `BigInt` at the read site.

`message.schema.ts` declares, beyond the `messageId` unique index:

- `{ timestamp: 1 }` — serves the cross-channel range query `findByTimestampRange` (the `/traffic` / `/traffic_me` aggregation hot path).
- `{ channelId: 1, timestamp: 1 }` — serves the per-channel range query `findByChannelAndTimestampRange` (and its `timestamp` sort, so there is no blocking in-memory SORT) plus `findRecentByChannel`'s reverse sort.

These predicates are plain, sargable half-open ranges (`{ timestamp: { $gte, $lt } }`). They are only index-served because stored timestamps are uniformly numeric — the queries were `$toLong`-wrapped (and therefore full collection scans) for legacy String-typed rows until the one-time [`migrate-timestamp`](../ops/migrate-timestamp.md) ops tool backfilled every timestamp to numeric. New writes are numeric (mongoose casts to the `Number` schema type), so no String rows are reintroduced.
