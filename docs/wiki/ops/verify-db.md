# Ops — verify-db

A **read-only** ops tool that runs a fixed battery of structural
validity checks against a guild's `messages` Mongo collection and
produces a JSON report.

`verify` is one subcommand of the unified `db` ops CLI. This page is a
quick-reference runbook; the field-by-field reference lives next to the
script in [`tools/db/README.md`](../../../tools/db/README.md).

## Rationale

The `message.schema.ts` mongoose schema declares
`messageId: { type: String, required: true, unique: true }`. Older
documents — written before `required: true` was introduced — persist
with `messageId: null` or empty-string values, and a few collections
contain duplicate `messageId`s left over from earlier ingest bugs.
The unique-index build aborts in either case with

```
MongoServerError: E11000 duplicate key error collection: ...
  index: messageId_1 dup key: { messageId: null }
```

and the collection ends up without the `messageId_1` index entirely
— the schema invariant the production code relies on is silently
absent.

This tool is the standard way to assess how bad the situation is
before invoking `msg_backup` (the remediation tool) and to confirm
afterwards that the cleanup actually worked. It also catches several
related data-integrity issues (`channelId` / `userId` / `userName`
empty, `timestamp` non-numeric or `<= 0`) that would otherwise stay
hidden until they crash a downstream report.

## Invocation

1. Copy `tools/db/config.example.json` to `tools/db/config.json`.
2. Fill in the shared `mongo_uri` and a **single-element** `guilds`
   array (`verify` operates on exactly one guild), plus optionally
   `operations.verify.sample_limit` and the shared `output_path`.
3. Run:
   ```
   yarn db verify
   ```

`config.json` is `.gitignore`d. The only CLI input is the subcommand
(and an optional `--config <path>`); every other input lives in the
config file.

## Tests

The pure internals (the config loader, the per-command contract, the
progress-writer factory) are covered by the unified `tools/db` unit
suite:

```
yarn db:test
```

The suite runs in the `tools` vitest project and does not require a
live Mongo connection.

## Exit codes

| Exit code | Meaning                                           |
| --------- | ------------------------------------------------- |
| `0`       | `PASS` — every check has zero violations.         |
| `1`       | `FAIL` — at least one check reported a violation. |

## Workflow

1. Run the verifier; note `messageId-null`, `messageId-empty-string`,
   and `messageId-duplicate` counts.
2. Run [`msg-backup`](msg-backup.md) against the affected guild to
   re-ingest history (which fills missing `messageId`s, deletes
   leftover bot messages, and de-duplicates).
3. Restart the bot — `Model.init()` should now build the
   `messageId_1` unique index without `E11000`.
4. Re-run the verifier; expect `PASS`.
