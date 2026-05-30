# `verify_db` — DB validity checker

A **read-only** ops tool that validates a guild's `messages` Mongo
collection against a fixed battery of structural checks and emits a
JSON report.

Replaces the older single-purpose `inspect-null-message-ids.ts`;
"messageId is null" is now one of eight checks instead of the whole
tool.

## Layout

```
tools/verify_db/
├── verify_db.ts          # process entry point — wires Mongo + stdout
├── internal.ts           # pure helpers (parseConfig, buildGuildUri, …)
├── config.example.json   # tracked — copy to config.json and edit
├── config.json           # gitignored — operator supplies credentials
└── README.md
```

## Configuration

Copy `config.example.json` to `config.json` and fill in:

| Field          | Type             | Required | Notes                                                                                 |
| -------------- | ---------------- | -------- | ------------------------------------------------------------------------------------- |
| `mongo_uri`    | `string`         | yes      | Base URI. If `authSource` is omitted the tool defaults it to `admin`.                 |
| `guild_id`     | `string`         | yes      | Per-guild Mongo DB name (Discord snowflake — digits only).                            |
| `sample_limit` | `integer >= 0`   | no       | Max sample docs per check. Default `50`. `0` disables sample collection (count only). |
| `output_path`  | `string \| null` | no       | When set, the JSON report is written to this path instead of stdout.                  |

There are **no CLI arguments** — everything comes from `config.json`.

## Running

```
yarn verify_db
```

The tool opens a single mongoose connection scoped to the named
guild's database, runs every check, and closes the connection in a
`finally`.

## Tests

The pure helpers (`parseConfig`, `buildGuildUri`, the
progress-writer factory) live in `tools/verify_db/internal.ts` and
are covered by a dedicated unit suite under
`tools/verify_db/verify_db.test.ts`:

```
yarn verify_db:test
```

The suite runs in the `tools` vitest project and does not require a
live Mongo connection.

## Checks

| Check                    | Detects                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `messageId-null`         | `messageId === null`                                                |
| `messageId-empty-string` | `messageId === ''`                                                  |
| `messageId-duplicate`    | Non-null `messageId` values that appear in more than one document.  |
| `channelId-missing`      | `channelId` is `null` or `''`.                                      |
| `userId-missing`         | `userId` is `null` or `''`.                                         |
| `userName-missing`       | `userName` is `null` or `''`.                                       |
| `timestamp-invalid`      | `timestamp` is not a `number`, or is `<= 0`.                        |
| `total-count`            | Informational — total document count. Never counted as a violation. |

For every filter-based check the tool collects up to `sample_limit`
offending documents and reports `_id`, the offending field's value,
`channelId`, `userId`, `timestamp`, and the first 50 chars of
`content`.

For `messageId-duplicate` the tool reports the offending `messageId`
values and how many documents share each one (`duplicateGroups`).
`violationCount` for duplicates is the total _extra_ row count
(a messageId shared by 3 docs contributes 2 to the count).

## Output

JSON to stdout (or `output_path`):

```json
{
  "guildId": "1047744170070118400",
  "totalCount": 12345678,
  "checks": [
    {
      "name": "messageId-null",
      "violationCount": 2680510,
      "sample": [
        /* ... */
      ]
    },
    { "name": "messageId-empty-string", "violationCount": 0, "sample": [] },
    { "name": "messageId-duplicate", "violationCount": 0, "duplicateGroups": [] },
    /* ... */
    { "name": "total-count", "violationCount": 0, "totalCount": 12345678 }
  ]
}
```

A final summary line is printed after the JSON:

- `PASS` when every check has `violationCount === 0` — exit code `0`.
- `FAIL (N violations across all checks)` otherwise — exit code `1`.

## Safety

- The tool never writes, updates, or deletes any document.
- `LOG_DIR=''` is forced at startup so the structured logger does
  not allocate any `logs/<bot>/...` file descriptors.
- Connection is closed on every exit path (success or failure).
- `config.json` is `.gitignore`d — never commit operator credentials.
