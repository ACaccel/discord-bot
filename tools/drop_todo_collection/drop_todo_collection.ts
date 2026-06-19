/**
 * Ops tool — permanently drop the retired `todo_list` feature's data.
 *
 * The `todo_list` command was removed; its `todos` collection lived in
 * each guild's own database (`{baseUri}{guildId}`). This one-off tool
 * connects to every guild listed in `config.json` and drops that guild's
 * `todos` collection so no orphaned data remains.
 *
 * Safety
 * ------
 * `config.dry_run` defaults to `true`: a dry run only counts the
 * documents it *would* remove and writes nothing. Set `dry_run: false`
 * explicitly to perform the drop. Re-runs are idempotent — a guild whose
 * collection is already gone is reported `absent`.
 *
 * Isolation
 * ---------
 * Each guild is processed inside its own `try/catch`; one guild's
 * failure (auth error, unreachable shard) never aborts the rest of the
 * fleet. Failures are collected into the report and flip the exit code
 * to 1.
 *
 * Configuration
 * -------------
 * All inputs come from `tools/drop_todo_collection/config.json`
 * (gitignored — never commit operator credentials). The schema is
 * documented in the sibling `config.example.json` and validated at
 * startup by `internal.parseConfig`. Output is a JSON report to stdout
 * (or `output_path`) plus a final PASS/FAIL line.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import mongoose, { type Connection } from 'mongoose';

import { createBootstrapLogger } from '../../src/core/config';

import { buildGuildUri, parseConfig, TODOS_COLLECTION } from './internal';

const CONFIG_PATH = resolve(__dirname, 'config.json');

/**
 * Per-guild result. `would-drop` is the dry-run counterpart of
 * `dropped`; `absent` means the collection was already gone (a no-op,
 * not a failure); `error` carries the sanitised failure message.
 */
type GuildOutcome =
  | { readonly guildId: string; readonly status: 'dropped'; readonly documentCount: number }
  | { readonly guildId: string; readonly status: 'would-drop'; readonly documentCount: number }
  | { readonly guildId: string; readonly status: 'absent' }
  | { readonly guildId: string; readonly status: 'error'; readonly error: string };

interface Report {
  readonly dryRun: boolean;
  readonly collection: string;
  readonly guilds: readonly GuildOutcome[];
}

const processGuild = async (
  baseUri: string,
  guildId: string,
  dryRun: boolean,
): Promise<GuildOutcome> => {
  const uri = buildGuildUri(baseUri, guildId);
  const connection: Connection = await mongoose.createConnection(uri).asPromise();
  try {
    const db = connection.db;
    if (db === undefined) {
      throw new Error(`mongoose connection has no resolved db handle for guild ${guildId}`);
    }
    const existing = await db.listCollections({ name: TODOS_COLLECTION }).toArray();
    if (existing.length === 0) {
      return { guildId, status: 'absent' };
    }
    const documentCount = await db.collection(TODOS_COLLECTION).countDocuments({});
    if (dryRun) {
      return { guildId, status: 'would-drop', documentCount };
    }
    await db.dropCollection(TODOS_COLLECTION);
    return { guildId, status: 'dropped', documentCount };
  } finally {
    await connection.close();
  }
};

const main = async (): Promise<void> => {
  // Force-disable the file-router sink for this one-shot ops invocation
  // so it does not pollute `logs/<bot>/...` with bot-less records.
  // `createBootstrapLogger` honours `LOG_DIR=''` as the explicit toggle.
  process.env['LOG_DIR'] = '';
  const logger = createBootstrapLogger({ component: 'drop_todo_collection' });

  const config = parseConfig(CONFIG_PATH);

  logger.info(
    { guildCount: config.guilds.length, dryRun: config.dryRun, collection: TODOS_COLLECTION },
    config.dryRun
      ? 'drop_todo_collection: DRY RUN — counting only, no data will be deleted.'
      : 'drop_todo_collection: dropping the todos collection in every configured guild.',
  );

  const outcomes: GuildOutcome[] = [];
  for (const guildId of config.guilds) {
    try {
      const outcome = await processGuild(config.mongoUri, guildId, config.dryRun);
      outcomes.push(outcome);
      logger.info(outcome, `guild ${guildId}: ${outcome.status}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ guildId, status: 'error', error: message });
      logger.error(
        { guildId, err: err instanceof Error ? err : new Error(message) },
        `guild ${guildId}: failed`,
      );
    }
  }

  const report: Report = {
    dryRun: config.dryRun,
    collection: TODOS_COLLECTION,
    guilds: outcomes,
  };
  const serialised = `${JSON.stringify(report, null, 2)}\n`;
  if (config.outputPath !== null) {
    writeFileSync(config.outputPath, serialised, 'utf8');
    logger.info({ outputPath: config.outputPath }, 'drop_todo_collection: results written');
  } else {
    process.stdout.write(serialised);
  }

  const errorCount = outcomes.filter((o) => o.status === 'error').length;
  if (errorCount === 0) {
    process.stdout.write('PASS\n');
    process.exitCode = 0;
  } else {
    process.stdout.write(`FAIL (${String(errorCount)} guild(s) errored)\n`);
    process.exitCode = 1;
  }
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[drop_todo_collection] FAIL: ${message}\n`);
  process.exit(1);
});
