/**
 * `db drop-todo` — permanently drop the retired `todo_list` feature's
 * data.
 *
 * The `todo_list` command was removed; its `todos` collection lived in
 * each guild's own database (`{baseUri}{guildId}`). This command connects
 * to every configured guild and drops that guild's `todos` collection so
 * no orphaned data remains.
 *
 * Safety: `dry_run` defaults to `true` — a dry run only counts the
 * documents it *would* remove and writes nothing. Set `dry_run: false`
 * explicitly to perform the drop. Re-runs are idempotent — a guild whose
 * collection is already gone is reported `absent`. Per-guild failure
 * isolation (via `runPerGuild`) keeps one guild's failure from aborting
 * the rest of the fleet; failures flip the exit code to 1.
 */
import type { Connection } from 'mongoose';
import { z } from 'zod';

import { defineCommand, type DbCommandResult } from '../framework/command';
import { runPerGuild, type GuildOutcome } from '../framework/guild-runner';

/** The MongoDB collection Mongoose pluralised the `Todo` model into. */
export const TODOS_COLLECTION = 'todos';

export const dropTodoOptionsSchema = z.object({
  dry_run: z.boolean().default(true),
});

type DropTodoOptions = z.infer<typeof dropTodoOptionsSchema>;

/** Per-guild success shapes; failures are carried by the `runPerGuild` outcome. */
type DropSuccess =
  | { readonly status: 'dropped'; readonly documentCount: number }
  | { readonly status: 'would-drop'; readonly documentCount: number }
  | { readonly status: 'absent' };

/**
 * The flattened per-guild report entry. `would-drop` is the dry-run
 * counterpart of `dropped`; `absent` means the collection was already
 * gone (a no-op, not a failure); `error` carries the sanitised message.
 */
type FlatOutcome =
  | { readonly guildId: string; readonly status: 'dropped'; readonly documentCount: number }
  | { readonly guildId: string; readonly status: 'would-drop'; readonly documentCount: number }
  | { readonly guildId: string; readonly status: 'absent' }
  | { readonly guildId: string; readonly status: 'error'; readonly error: string };

interface DropReport {
  readonly dryRun: boolean;
  readonly collection: string;
  readonly guilds: readonly FlatOutcome[];
}

const processGuild = async (
  connection: Connection,
  guildId: string,
  dryRun: boolean,
): Promise<DropSuccess> => {
  const db = connection.db;
  if (db === undefined) {
    throw new Error(`mongoose connection has no resolved db handle for guild ${guildId}`);
  }
  const existing = await db.listCollections({ name: TODOS_COLLECTION }).toArray();
  if (existing.length === 0) {
    return { status: 'absent' };
  }
  const documentCount = await db.collection(TODOS_COLLECTION).countDocuments({});
  if (dryRun) {
    return { status: 'would-drop', documentCount };
  }
  await db.dropCollection(TODOS_COLLECTION);
  return { status: 'dropped', documentCount };
};

const toFlatOutcome = (o: GuildOutcome<DropSuccess>): FlatOutcome =>
  o.ok && o.result !== null
    ? { guildId: o.guildId, ...o.result }
    : { guildId: o.guildId, status: 'error', error: o.error ?? 'unknown error' };

export const dropTodoCommand = defineCommand<DropTodoOptions>({
  name: 'drop-todo',
  description: "Drop the retired todo_list feature's todos collection per guild.",
  optionsSchema: dropTodoOptionsSchema,
  run: async ({ shared, options, logger, withGuildConnection }): Promise<DbCommandResult> => {
    logger.info(
      { guildCount: shared.guilds.length, dryRun: options.dry_run, collection: TODOS_COLLECTION },
      options.dry_run
        ? 'db drop-todo: DRY RUN — counting only, no data will be deleted.'
        : 'db drop-todo: dropping the todos collection in every configured guild.',
    );

    const outcomes = await runPerGuild<DropSuccess>(
      shared.guilds,
      (guildId) =>
        withGuildConnection(guildId, (connection) =>
          processGuild(connection, guildId, options.dry_run),
        ),
      logger,
      'db drop-todo',
    );

    const guilds = outcomes.map(toFlatOutcome);
    const report: DropReport = { dryRun: options.dry_run, collection: TODOS_COLLECTION, guilds };
    const errorCount = guilds.filter((g) => g.status === 'error').length;
    return {
      report,
      summaryLine: errorCount === 0 ? 'PASS' : `FAIL (${String(errorCount)} guild(s) errored)`,
      exitCode: errorCount === 0 ? 0 : 1,
    };
  },
});
