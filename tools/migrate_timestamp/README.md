# migrate_timestamp

Ops tool that migrates the `Message.timestamp` field to a uniform numeric
type across every guild database, so the `MessageRepo` range queries can
drop the non-sargable `$toLong` predicate and become index-served.

## Why

`timestamp` is logically epoch-ms, but the pre-refactor schema stored it
as a **String**, so legacy rows (archived before the persistence-layer
refactor) may hold String values while every current write is numeric.
`findByTimestampRange` / `findByChannelAndTimestampRange` wrap every
comparison in `$expr: { $toLong: '$timestamp' }` to tolerate the mix — a
computed predicate no btree index can serve, forcing a full collection
scan. This tool makes the data uniformly numeric so that predicate (and
the scan) can go away.

> **Hard gate.** The repo predicate change (drop `$toLong`, add the
> indexes) MUST NOT ship to any guild whose data still has String-typed
> timestamps: a plain `{ timestamp: { $gte, $lt } }` silently excludes
> String rows (string vs number BSON bracket), undercounting `/traffic`.
> Run `audit` → `convert` → re-`audit` and confirm **zero** String-typed
> timestamps fleet-wide before deploying the code change.

## Configuration

All inputs come from `tools/migrate_timestamp/config.json` (gitignored —
never commit operator credentials). Copy `config.example.json` and fill
it in; the schema is validated at startup by `internal.parseConfig`.

| field          | type           | required | meaning                                                            |
| -------------- | -------------- | -------- | ------------------------------------------------------------------ |
| `mongo_uri`    | string         | yes      | Base cluster URI; per-guild db name + `authSource=admin` appended. |
| `guilds`       | string[]       | yes      | All-digit guild ids; each is a separate database to process.       |
| `mode`         | enum           | yes      | `audit` \| `convert` \| `index`.                                   |
| `dry_run`      | boolean        | no       | `convert` only: count + sample, write nothing. Default `false`.    |
| `sample_limit` | integer >= 0   | no       | Cap on `_id` samples in reports. Default `20`.                     |
| `output_path`  | string \| null | no       | Write the JSON report here instead of stdout. Default `null`.      |

Run with: `yarn migrate_timestamp` (edit `mode` between phases).

## Runbook

1. **Audit** (`mode: "audit"`, read-only, all guilds). Reports per guild:
   total, `string-typed`, `numeric-string` (convertible), `non-numeric-string`
   (garbage → manual triage), `null-or-missing`. The final line recommends
   whether conversion is needed.
   - If every guild reports `string-typed == 0` → **skip convert**, go to
     step 4 (index).
2. **Convert** (`mode: "convert"`, write, only guilds with convertible
   rows). For each such guild the tool, in order:
   1. takes a **mandatory** in-database snapshot
      `messages_backup_pre_ts_<UTC>` and asserts its count equals the
      source (fail-fast — no backup, no convert);
   2. runs the String → numeric `updateMany` (pipeline `$convert`, leaving
      any unconvertible value untouched);
   3. re-counts convertible rows and requires `0`.
   - Preview first with `dry_run: true` (counts + `_id` sample, no writes).
   - `non-numeric-string` rows are **never** auto-converted; they are
     reported for manual triage and keep the deploy gate closed until you
     resolve them.
   - For the largest / most critical guilds, also take an off-box dump:
     `mongodump --uri <guildUri> --collection messages --out tools/migrate_timestamp/backups/<guildId>-<ts>/`.
3. **Verify**: re-run `audit`; confirm `string-typed == 0` for every guild.
   This is the gate for deploying the repo predicate change.
4. **Index** (`mode: "index"`, write, all guilds, in a maintenance window).
   Builds `{ timestamp: 1 }` and `{ channelId: 1, timestamp: 1 }` per
   guild (idempotent). Do this before the schema change ships so the next
   boot's `model.init()` finds the indexes present and stays a no-op.
5. **Deploy** the repo predicate change (drop `$toLong`, schema index
   declarations). Re-run `audit` once more as a final fleet gate first.

## Safety & restore

- **Backup is mandatory and fail-fast**: convert refuses to write a guild
  until its `$out` snapshot exists and its count matches the source.
- **Conversion is value-preserving and monotonic**: only the BSON type
  changes (String → Long), the numeric value is identical, so sort order
  and counts are unchanged. Converted rows (Long) and existing
  mongoose-written rows (Double) share one numeric index bracket — both
  range-query and index correctly.
- **Idempotent**: re-runs match nothing already numeric.
- **Restore** (same-db snapshot): `db.messages.drop()` then
  `db.messages_backup_pre_ts_<ts>.aggregate([{ $out: 'messages' }])`.
- **Restore** (mongodump): `mongorestore --uri <guildUri> --drop --nsInclude '<db>.messages' tools/migrate_timestamp/backups/<guildId>-<ts>/`.
- **Cleanup**: once the fleet is verified and the deploy is observed
  stable, drop the `messages_backup_pre_ts_*` collections / dumps.

## Exit codes

- `audit` — always `0` (read-only). Recommendation is on the final line.
- `convert` — `0` when every guild is converted and verified clean (or
  dry-run); `1` if any guild errored or is left with String-typed
  timestamps (manual triage needed). The deploy gate keys off this.
- `index` — `0` when indexes are ensured on every guild; `1` on any error.
