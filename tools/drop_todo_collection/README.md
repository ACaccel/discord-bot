# `drop_todo_collection` — retire the `todo_list` data

A one-off ops tool that permanently deletes the data left behind by the
removed `todo_list` command. The feature stored its items in a `todos`
collection inside **each guild's own database** (`{baseUri}{guildId}`),
so cleanup means connecting to every guild and dropping that collection.

**Dry-run by default.** With `dry_run: true` (the default) the tool only
counts the documents it would remove and writes nothing. Set
`dry_run: false` explicitly to perform the drop. Re-runs are idempotent:
a guild whose collection is already gone is reported `absent`.

## Layout

```
tools/drop_todo_collection/
├── drop_todo_collection.ts   # process entry point — wires Mongo + stdout
├── internal.ts               # pure helpers (parseConfig, buildGuildUri)
├── config.example.json       # tracked — copy to config.json and edit
├── config.json               # gitignored — operator supplies credentials
└── README.md
```

## Configuration

Copy `config.example.json` to `config.json` and fill in:

| Field         | Type             | Default | Meaning                                                           |
| ------------- | ---------------- | ------- | ----------------------------------------------------------------- |
| `mongo_uri`   | string           | —       | Base URI of the cluster (the per-guild db name is spliced in).    |
| `guilds`      | string[]         | —       | Guild ids (all-digit) whose `todos` collection should be dropped. |
| `dry_run`     | boolean          | `true`  | `true` counts only; `false` performs the drop.                    |
| `output_path` | string \| `null` | `null`  | Write the JSON report here instead of stdout.                     |

`config.json` is gitignored — never commit operator credentials.

## Runbook

```bash
# 1. Audit — confirm the per-guild counts look right (dry_run: true).
yarn drop_todo_collection

# 2. Drop — set "dry_run": false in config.json, then re-run.
yarn drop_todo_collection

# 3. (optional) Re-run to confirm every guild now reports "absent".
yarn drop_todo_collection
```

## Output

A JSON report to stdout (or `output_path`), then a final `PASS` / `FAIL`
line. Per guild the `status` is one of:

- `would-drop` — dry run; the collection exists and holds `documentCount` docs.
- `dropped` — the collection was dropped (`documentCount` removed).
- `absent` — the collection was already gone (no-op).
- `error` — connecting/dropping failed for that guild (`error` carries why).

The exit code is `0` when no guild errored, `1` otherwise. A guild
failure never aborts the rest of the fleet.

## Tests

```bash
yarn drop_todo_collection:test
```

Covers the pure helpers (`parseConfig`, `buildGuildUri`); the Mongo
lifecycle is verified by manual runs against a real cluster.
