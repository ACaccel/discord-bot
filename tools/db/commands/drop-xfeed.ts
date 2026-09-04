/**
 * `db drop-xfeed` — permanently drop the retired X-media-feed cursor
 * data.
 *
 * The social-feed rewrite moved every subscription and its polling
 * cursor into one `feedsubscriptions` document, so the old per-handle
 * `xfeedcursors` collection is no longer read or written. Removing a
 * model does not remove its data, so the collection lives on in each
 * guild's own database (`{baseUri}{guildId}`) until an operator clears
 * it. This command connects to every configured guild and drops it.
 *
 * Nothing is migrated: the old cursors were keyed by handle alone,
 * while a subscription now tracks its position per platform, account,
 * and channel. Re-subscribing seeds a fresh cursor from the present.
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

/** The MongoDB collection Mongoose pluralised the retired `XFeedCursor` model into. */
export const XFEED_CURSORS_COLLECTION = 'xfeedcursors';

export const dropXfeedOptionsSchema = z.object({
  dry_run: z.boolean().default(true),
});

type DropXfeedOptions = z.infer<typeof dropXfeedOptionsSchema>;

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
  const existing = await db.listCollections({ name: XFEED_CURSORS_COLLECTION }).toArray();
  if (existing.length === 0) {
    return { status: 'absent' };
  }
  const documentCount = await db.collection(XFEED_CURSORS_COLLECTION).countDocuments({});
  if (dryRun) {
    return { status: 'would-drop', documentCount };
  }
  await db.dropCollection(XFEED_CURSORS_COLLECTION);
  return { status: 'dropped', documentCount };
};

const toFlatOutcome = (o: GuildOutcome<DropSuccess>): FlatOutcome =>
  o.ok && o.result !== null
    ? { guildId: o.guildId, ...o.result }
    : { guildId: o.guildId, status: 'error', error: o.error ?? 'unknown error' };

export const dropXfeedCommand = defineCommand<DropXfeedOptions>({
  name: 'drop-xfeed',
  description: 'Drop the retired X-media-feed xfeedcursors collection per guild.',
  optionsSchema: dropXfeedOptionsSchema,
  run: async ({ shared, options, logger, withGuildConnection }): Promise<DbCommandResult> => {
    logger.info(
      {
        guildCount: shared.guilds.length,
        dryRun: options.dry_run,
        collection: XFEED_CURSORS_COLLECTION,
      },
      options.dry_run
        ? 'db drop-xfeed: DRY RUN — counting only, no data will be deleted.'
        : 'db drop-xfeed: dropping the xfeedcursors collection in every configured guild.',
    );

    const outcomes = await runPerGuild<DropSuccess>(
      shared.guilds,
      (guildId) =>
        withGuildConnection(guildId, (connection) =>
          processGuild(connection, guildId, options.dry_run),
        ),
      logger,
      'db drop-xfeed',
    );

    const guilds = outcomes.map(toFlatOutcome);
    const report: DropReport = {
      dryRun: options.dry_run,
      collection: XFEED_CURSORS_COLLECTION,
      guilds,
    };
    const errorCount = guilds.filter((g) => g.status === 'error').length;
    return {
      report,
      summaryLine: errorCount === 0 ? 'PASS' : `FAIL (${String(errorCount)} guild(s) errored)`,
      exitCode: errorCount === 0 ? 0 : 1,
    };
  },
});
