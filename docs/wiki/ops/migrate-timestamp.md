# Ops — migrate-timestamp

A multi-guild ops tool that migrates the `Message.timestamp` field to a
uniform numeric type so the `MessageRepo` range queries can drop the
non-sargable `$toLong` predicate and become index-served.

`migrate-timestamp` is one subcommand of the unified `db` ops CLI. This
page is a quick-reference runbook; the field-by-field reference and the
full safety/restore notes live next to the script in
[`tools/db/README.md`](../../../tools/db/README.md).

## Rationale

`message.schema.ts` declares `timestamp: { type: Number }`, but the
pre-refactor schema (`src/db/schema.ts`) stored it as a **String**, so
legacy rows may hold String values while every current write is numeric.
`MongoMessageRepo.findByTimestampRange` / `findByChannelAndTimestampRange`
therefore wrapped each comparison in `$expr: { $toLong: '$timestamp' }` —
a computed predicate no btree index can serve, forcing a full collection
scan on every `/traffic`, `/traffic_me`, and `db_list_message` read.

This tool makes the data uniformly numeric so that predicate (and the
scan) can be replaced by a plain, index-served range. The numeric
`{ timestamp: 1 }` and compound `{ channelId: 1, timestamp: 1 }` indexes
are declared on the schema (C4) and pre-built by this tool's `index` mode.

> **Hard gate.** The repo predicate change must NOT ship to any guild
> whose data still has String-typed timestamps: a plain
> `{ timestamp: { $gte, $lt } }` silently excludes String rows (string vs
> number BSON bracket), undercounting `/traffic`. Confirm **zero**
> String-typed timestamps fleet-wide (re-run `audit`) before deploying.

## Invocation

1. Copy `tools/db/config.example.json` to `tools/db/config.json`.
2. Fill in the shared `mongo_uri` and `guilds`, plus
   `operations.migrate-timestamp.mode` (`audit` | `convert` | `index`).
3. Run:
   ```
   yarn db migrate-timestamp
   ```

`config.json` is `.gitignore`d. The only CLI input is the subcommand
(and an optional `--config <path>`); every other input lives in the
config file — change `operations.migrate-timestamp.mode` between phases.

## Workflow

1. **audit** (read-only, all guilds) — counts String-typed /
   numeric-string / non-numeric-string / null-or-missing timestamps and
   prints a fleet recommendation. If every guild reports zero
   String-typed timestamps, skip convert and go straight to `index`.
2. **convert** (`dry_run: true` first to preview) — for each guild with
   convertible rows: takes a **mandatory** in-database snapshot
   `messages_backup_pre_ts_<UTC>` (fail-fast — no backup, no convert),
   runs the String → numeric `updateMany`, and re-verifies the
   convertible count is `0`. Non-numeric "garbage" strings are never
   auto-converted — they are reported for manual triage and keep the gate
   closed until resolved.
3. **verify** — re-run `audit`; confirm zero String-typed timestamps for
   every guild. This is the gate for the code deploy.
4. **index** (write, in a maintenance window) — builds
   `{ timestamp: 1 }` and `{ channelId: 1, timestamp: 1 }` per guild
   (idempotent), before the schema change ships so the next boot's
   `model.init()` is a no-op.
5. **deploy** the repo predicate change; re-run `audit` once more first
   as a final fleet gate.

## Safety & restore

- Backup is **mandatory and fail-fast** (count-verified `$out` snapshot).
- Conversion is **value-preserving, monotonic, and idempotent** — only
  the BSON type changes (String → Long), so counts and sort order are
  unchanged, and re-runs match nothing already numeric.
- Restore (snapshot): `db.messages.drop()` then
  `db.messages_backup_pre_ts_<ts>.aggregate([{ $out: 'messages' }])`.
- See the script README for the optional off-box `mongodump` /
  `mongorestore` path and backup cleanup.

## Tests

The pure internals (the config loader, the audit/convert/index builders,
the failure/summary derivation) are covered by the unified `tools/db`
unit suite that needs no live Mongo:

```
yarn db:test
```

## Exit codes

| Mode      | Exit `0`                                            | Exit `1`                                                |
| --------- | --------------------------------------------------- | ------------------------------------------------------- |
| `audit`   | always (read-only); recommendation on the last line | —                                                       |
| `convert` | every guild converted + verified clean (or dry-run) | a guild errored or is left with String-typed timestamps |
| `index`   | indexes ensured on every guild                      | a guild errored                                         |
