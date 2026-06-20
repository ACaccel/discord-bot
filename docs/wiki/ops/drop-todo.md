# Ops — drop-todo

A one-off ops tool that permanently drops the retired `todo_list`
feature's `todos` collection from every configured guild's database.

`drop-todo` is one subcommand of the unified `db` ops CLI. This page is a
quick-reference runbook; the field-by-field reference lives next to the
script in [`tools/db/README.md`](../../../tools/db/README.md).

## Rationale

The `todo_list` command was removed. Its items lived in a `todos`
collection inside **each guild's own database** (`{baseUri}{guildId}`),
so cleanup means connecting to every guild and dropping that collection.
The tool is idempotent — a guild whose collection is already gone is
reported `absent`.

## Invocation

1. Copy `tools/db/config.example.json` to `tools/db/config.json`.
2. Fill in the shared `mongo_uri` and `guilds`. `operations.drop-todo.dry_run`
   defaults to `true` (count only); set it to `false` to perform the drop.
3. Run:
   ```
   yarn db drop-todo
   ```

`config.json` is `.gitignore`d. The only CLI input is the subcommand
(and an optional `--config <path>`); every other input lives in the
config file.

## Workflow

```bash
# 1. Audit — confirm the per-guild counts (dry_run: true, the default).
yarn db drop-todo
# 2. Drop — set operations.drop-todo.dry_run = false, then re-run.
yarn db drop-todo
# 3. (optional) Re-run to confirm every guild now reports "absent".
yarn db drop-todo
```

## Output

A JSON report to stdout (or the shared `output_path`), then a final
`PASS` / `FAIL` line. Per guild the `status` is one of:

- `would-drop` — dry run; the collection exists and holds `documentCount` docs.
- `dropped` — the collection was dropped (`documentCount` removed).
- `absent` — the collection was already gone (no-op).
- `error` — connecting/dropping failed for that guild (`error` carries why).

A single guild's failure never aborts the rest of the fleet.

## Tests

```
yarn db:test
```

Covers the options schema (notably dry-run-by-default) and command
metadata; the Mongo lifecycle is verified by manual runs against a real
cluster.

## Exit codes

| Exit code | Meaning                              |
| --------- | ------------------------------------ |
| `0`       | `PASS` — no guild errored.           |
| `1`       | `FAIL` — at least one guild errored. |
