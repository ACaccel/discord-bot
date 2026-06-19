# 0004 - Index-served `Message.timestamp` Range Reads

- Date: 2026-06-18
- Status: accepted
- Supersedes: -

## Context

With timestamps uniformly numeric
([0003](0003-migrate-timestamp-numeric-migration.md)), the message range queries
could drop their computed predicate. `MongoMessageRepo.findByTimestampRange` and
`findByChannelAndTimestampRange` used a `$toLong` / `$expr` comparison that
forced a full collection scan (and an in-memory SORT for the per-channel query),
driving the cost of every `/traffic`, `/traffic_me`, and `db_list_message` read.

## Options considered

- A. Keep the `$expr` / `$toLong` predicate. Rejected: not sargable, so it can
  never use an index — the scan cost is structural.
- B. Replace it with a plain half-open numeric range and add covering indexes.
  Chosen, contingent on 0003 having normalised the data first.

## Decision

Both repo methods now use a plain half-open range
(`{ timestamp: { $gte, $lt } }`), and `message.schema.ts` declares
`{ timestamp: 1 }` and `{ channelId: 1, timestamp: 1 }` indexes, turning the
full scan into an index range scan and removing the per-channel in-memory SORT.
The predicate change must not deploy to a guild whose stored timestamps are still
String-typed — `migrate_timestamp` (0003) performs that one-time backfill first.
New writes are already numeric (Mongoose casts to the `Number` schema type), so
no String rows are reintroduced.

## Rationale

A sargable range predicate plus a compound `{ channelId, timestamp }` index lets
MongoDB serve both the global and per-channel reads directly from an index,
eliminating the scan and the SORT. The hard ordering dependency on 0003 is
recorded here because deploying the predicate against String data would silently
return wrong (lexicographic) results.
