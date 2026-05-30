# Ops — msg-backup

Full-history Discord message re-ingest for one or more guilds.
Walks every accessible channel newest-to-oldest from `start_date`
(or from the very beginning when empty) and **unconditionally
upserts** every fetched message — the DB row is overwritten in
full each run, so reaction counts, content edits, and attachment
metadata always re-align with Discord-side truth.

This page is a quick-reference runbook; the field-by-field
reference, sink layout, and runtime characteristics live next to
the script in
[`tools/msg_backup/README.md`](../../../tools/msg_backup/README.md).

## When to use it

Use `msg_backup` when a guild's `messages` collection has drifted
from Discord-side truth and needs a one-shot reconciliation —
typically signalled by `verify_db` reporting non-zero violations
for any of `messageId-null`, `messageId-empty-string`, or
`messageId-duplicate`, OR by a report that reaction counts /
edited message content in the DB no longer match Discord.

The bot's runtime backup plugin (`src/plugins/message-backup/`)
handles the steady-state incremental ingest. **Do not** run
`msg_backup` as a nightly cron — it is a recovery hammer, not a
maintenance job.

## Invocation

1. Copy `tools/msg_backup/config.example.json` to
   `tools/msg_backup/config.json`.
2. Fill in `mongo_uri`, `discord_token`, and `guilds` (at least
   one Discord snowflake id). Adjust `start_date`,
   `delete_bot_messages`, and `batch_size` as needed. `batch_size`
   defaults to `500`.
3. Run, preferably under `tmux` or `screen` (large guilds take
   many hours):
   ```
   yarn msg_backup
   ```

`config.json` is `.gitignore`d. There are **no CLI arguments**.

## Tests

The pure internals (`parseConfig`, `buildBackfillDoc`,
`isTransientError`, `withRetry`, `buildAnomalies`) are covered by a
dedicated unit suite under `tools/msg_backup/msg_backup.test.ts`:

```
yarn msg_backup:test
```

The suite runs in the `tools` vitest project and exercises the
retry / field-skip / anomaly logic without booting Discord or Mongo.

## Exit codes

| Exit code | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `0`       | Every configured guild reconciled successfully.                              |
| `1`       | At least one guild failed cleanup completely (the rest are still attempted). |

A guild is only marked `failed` when **every** cleanup check
errored. Partial cleanup failures (a single check throwing) leave
the guild in `ok` and the failing check renders as `ERROR (<reason>)`
in the summary.

## Behaviour summary

- For each guild, opens a per-guild Mongo connection through the
  project's `MongoConnectionManager`.
- **Cleanup pass first**: seven validity checks deleting any rows
  failing them (`messageId` null/empty, `messageId` duplicates,
  `channelId`/`userId`/`userName` null/empty, `timestamp`
  non-numeric, plus a total-count stat). Each check runs in its own
  `try`/`catch`; per-check progress emits to stdout and the run log.
- Discovers text-like guild channels + active threads + archived
  threads. The archived-thread list is **paginated** — long-lived
  forums no longer silently lose history past the first 50 threads.
  `guild.channels.fetch()` is capped at 60s; on timeout the guild
  yields a single `guild-not-accessible` channel-like row.
- For each channel, walks Discord newest-to-oldest in pages of 100,
  stopping when older than `start_date` (or never, if empty).
  Every non-bot, non-null-author message is queued for `bulkWrite`
  upsert — the row is overwritten in full each run.
- `msg.author === null` (deleted webhook, removed cross-post
  source) → counted as `skipped-null-author`, NOT upserted.
- Bot-authored messages → deleted from DB when
  `delete_bot_messages=true` (the default).
- After each channel, `Fetch.lastMessageID` is upserted to the
  newest message id seen — or `''` for an empty channel, so
  msg-archive's incremental path has a row to read against either
  way.
- Transient `messages.fetch` failures (HTTP 5xx, node-level
  network errors) trigger an exponential backoff retry
  (1s → 2s → 4s). Hard non-transient codes (50001/50013/10003/10004
  etc) bypass retries and surface as dedicated statuses.
- Per-guild error isolation: a failure on one guild logs and the
  tool continues with the next.

## Channel outcome statuses

| Status                  | Meaning                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`                    | Channel completed without retries or persistence issues.                                                                                                                                                                |
| `retried-but-ok`        | Channel finished, but at least one transient retry fired during fetch.                                                                                                                                                  |
| `aborted`               | Mid-channel exception bubbled out of `withRetry`.                                                                                                                                                                       |
| `no-permission`         | DiscordAPIError 50001 / 50013 — bot lacks View Channel / Read Message History.                                                                                                                                          |
| `channel-not-found`     | DiscordAPIError 10003 / 10004 — channel or guild went away mid-run.                                                                                                                                                     |
| `guild-not-accessible`  | `guild.fetch()` failed; the whole guild yields a single placeholder row.                                                                                                                                                |
| `cursor-persist-failed` | Backfill succeeded but the `Fetch` upsert threw; data intact, cursor stale.                                                                                                                                             |
| `thread-enum-failed`    | Parent-channel thread enumeration failed; its threads were not backfilled.                                                                                                                                              |
| `field-skip-ok`         | Channel completed `ok`, but at least one message triggered the field-skip rule (Discord returned a null nested field, so attachments / reactions / stickers was OMITTED from the upsert to preserve the DB-side value). |

### Field-skip behaviour

The three nested arrays — `attachments`, `reactions`, `stickers` —
are subject to a "preserve the DB-side value" guarantee. When
Discord returns a message whose attachment / reaction / sticker
element carries a critical `null` (typically an attachment whose
`name` is missing because the source webhook was deleted, or a
sticker whose `name` is missing because the third-party pack was
removed), `buildBackfillDoc` **omits the entire corresponding array
from the `$set` payload**. Mongo's `$set` with a missing key
preserves the prior value, so the DB is never overwritten with
fallback empty values.

The whole array is dropped (not just the bad element) because Mongo
`$set` cannot do partial-array merge — writing a filtered subset
would still wipe out anything the DB had that Discord did not
return this time. These edge messages are very rare; preserving the
DB's prior (likely-also-edge) state is the safer default than
substituting `''` placeholders.

Channels that triggered field-skip are surfaced in the Anomaly
list as `field-skip-ok` (when otherwise clean) or, when they also
hit transport retries, as `retried-but-ok` — transport flakiness
wins on precedence because it matters more to operators than
per-message edge cases. The per-channel, per-month, per-guild, and
overall summaries include dedicated `skipped-attachments`,
`skipped-reactions`, and `skipped-stickers` counters so the events
are auditable after the fact.

## Anomaly list

Every per-guild summary ends with an `Anomaly list:` section that
lists every channel whose status is not `ok` (plus any
`retried-but-ok` channels). Operators can sweep this section to
see exactly which channels need attention without diffing the
verbose per-channel logs.

## Logging

Two sinks side by side:

| Sink                                                         | Format      | Purpose                                       |
| ------------------------------------------------------------ | ----------- | --------------------------------------------- |
| Pretty stdout                                                | pino-pretty | Live monitoring while the tool runs.          |
| `tools/msg_backup/logs/msg_backup_<YYYY-MM-DD_HH-MM-SS>.log` | pure text   | One human-readable file per run, no rotation. |

The text-log layout is fixed: a boxed config header (with
`mongo_uri` password masked as `****` and a `Server timezone:
UTC±H` line for cross-run auditability), per-guild cleanup block
with per-check progress, channel discovery list with per-batch
thread pagination progress, per-channel progress with one line per
month boundary, per-guild summary with the `Anomaly list`, an
`OVERALL SUMMARY` with a "sorted by upserted desc" per-channel
breakdown, and an `End of run (status: COMPLETED|FAILED)` footer.
The format is implemented by `tools/msg_backup/text-logger.ts`.

Run-log writes are wrapped in `try`/`catch`; if the file becomes
unwritable mid-run, subsequent output mirrors to stderr and the
tool prints a closing warning. Bucket aggregation uses the server's
local timezone — keep the operator host's timezone stable across
runs to keep monthly numbers comparable.

There is **no** JSON Lines output, no daily rotation, and no
separate `error.log`. Fatal failures appear inline in the same
file and the footer reads `FAILED`.

## Workflow

1. Run [`verify-db`](verify-db.md) to confirm the guild actually
   needs remediation.
2. Run `msg_backup` against that guild.
3. Restart the affected bot — `Model.init()` should now build the
   `messages.messageId_1` unique index without `E11000`.
4. Re-run `verify-db` to confirm `PASS`.
