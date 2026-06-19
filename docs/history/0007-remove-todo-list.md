# 0007 - Permanently remove the `todo_list` feature

- Date: 2026-06-19
- Status: accepted
- Supersedes: -

## Context

The `/todo_list` slash command (a flat add / delete / list to-do list on
the `nijika` personality) was retired. The request was to remove the
feature permanently **and** delete the data it left behind. Two points
needed a decision before implementing:

- **How to delete the data.** The feature stored items in a `todos`
  collection inside _each guild's own_ MongoDB database
  (`{baseUri}{guildId}`), so cleanup is a per-guild collection drop, not
  a single statement.
- **How to retire the registered slash command.** The command is
  published to Discord from `nijika`'s gitignored `config.json`
  `commands` list, so removing the code is not enough to make it
  disappear from the client.

## Options considered

- **Data cleanup: a committed ops tool (chosen).** Add
  `tools/drop_todo_collection/`, mirroring the existing
  `tools/verify_db` / `tools/migrate_timestamp` convention: gitignored
  `config.json` (operator credentials + an explicit `guilds` list),
  dry-run by default, per-guild `try/catch` isolation, a JSON report,
  and a PASS/FAIL exit code, with pure helpers unit-tested under the
  `tools` vitest project.
  - Rejected — **manual `mongosh` commands**: leaves no auditable,
    repeatable artifact and is error-prone across many guild databases.
  - Rejected — **a startup migration in the bot**: bakes one-time
    destructive cleanup into the long-lived runtime, which then has to be
    removed again; an ops tool keeps the concern out of the hot path.
  - Rejected — **leaving the data orphaned**: contrary to the explicit
    request to delete it.

- **Cleanup scope: an explicit operator-supplied `guilds` list (chosen).**
  The tool only touches the guild databases named in `config.json`.
  - Rejected — **enumerate every database on the cluster and drop
    `todos` wherever it appears**: convenient but unsafe, since it would
    reach databases unrelated to this bot. An explicit list keeps the
    blast radius operator-controlled.

- **Slash-command retirement: edit `config.json` + redeploy (chosen).**
  Remove `"todo_list"` from `nijika`'s `config.json` `commands` array and
  re-run `yarn deploy -t nijika`; the global PUT republishes the command
  set without it, and Discord prunes the removed command.

## Decision

Delete all `todo_list` code (command handler, `TodoRepo`/`MongoTodoRepo`,
`todoSchema`/`TodoDoc`, the `Todo` model registration, and the
integration test), remove its `commands:todo_list.*` / `replies:todo_list.*`
catalog keys from both locales, regenerate the command registry, and
remove `"todo_list"` from `nijika`'s `config.json`. Ship a dry-run-first
`tools/drop_todo_collection/` ops tool that drops the `todos` collection
in each operator-listed guild database. The operator runs the tool to
delete the data and re-runs `yarn deploy -t nijika` to drop the slash
command from Discord.

## Rationale

Treating the data deletion as an auditable, repeatable, dry-run-first ops
tool — rather than ad-hoc shell commands or runtime migration code —
matches the precedent already set by `verify_db` and `migrate_timestamp`
and keeps a one-time destructive action reviewable and idempotent. Making
the cleanup scope an explicit `guilds` list, rather than auto-discovering
collections cluster-wide, bounds the blast radius to exactly what the
operator intends. The code removal touches the schema registry, the repo
bundle, and the connection manager together because `Models` is derived
from `SchemaName`; recording that here flags the three-file coupling for
any future model removal.
