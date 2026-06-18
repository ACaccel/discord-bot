/**
 * Ops tool — migrate the `Message.timestamp` field to a uniform numeric
 * type across every guild database, so the `MessageRepo` range queries
 * can drop `$toLong` and become index-served.
 *
 * Three modes (selected via `config.json` `mode`):
 *   - `audit`   read-only. Per guild, count String-typed / numeric-string
 *               / non-numeric-string / null-or-missing timestamps and
 *               print a fleet recommendation. ALWAYS exits 0.
 *   - `convert` write. For each guild with convertible rows: take a
 *               mandatory in-database snapshot (fail-fast — no backup,
 *               no convert), run the String → numeric `updateMany`, then
 *               re-verify the convertible count is 0. `dry_run: true`
 *               counts + samples without writing. Exits 1 if any guild
 *               is left non-clean or fails.
 *   - `index`   write. Build `{ timestamp: 1 }` and
 *               `{ channelId: 1, timestamp: 1 }` per guild (idempotent).
 *
 * Per-guild `try/catch` isolation: one guild's failure never aborts the
 * rest of the fleet; re-runs are idempotent. See the sibling README for
 * the full runbook (audit → convert → verify → index → deploy) and the
 * hard gate: the Phase-D repo predicate change must not ship until every
 * guild reports zero String-typed timestamps.
 *
 * Configuration comes from `tools/migrate_timestamp/config.json`
 * (gitignored — never commit operator credentials), validated at startup
 * by `internal.parseConfig`. Output is a JSON report to stdout (or
 * `output_path`) plus a final PASS/FAIL/RECOMMENDATION line.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import mongoose, { type Connection } from 'mongoose';

import { createBootstrapLogger } from '../../src/core/config';
import { buildGuildMongoUri } from '../../src/infra/mongo/connection-manager';

import {
  backupCollectionName,
  buildConvertFilter,
  buildConvertPipeline,
  buildIndexSpecs,
  NON_NUMERIC_STRING_FILTER,
  NULL_OR_MISSING_FILTER,
  NUMERIC_STRING_FILTER,
  parseConfig,
  STRING_TYPED_FILTER,
  type MigrateConfig,
} from './internal';

const CONFIG_PATH = resolve(__dirname, 'config.json');
const MESSAGES_COLLECTION = 'messages';

// Derive the resolved db handle from mongoose's own `Connection` type so the
// tool does not take a direct dependency on the `mongodb` driver package (it
// is only a transitive dependency of mongoose, as in the sibling ops tools).
type GuildDb = NonNullable<Connection['db']>;

interface AuditGuildResult {
  readonly mode: 'audit';
  readonly total: number;
  readonly stringTyped: number;
  readonly numericString: number;
  readonly nonNumericString: number;
  readonly nullOrMissing: number;
}

type ConvertStatus = 'converted' | 'already-clean' | 'dry-run' | 'manual-triage-required';

interface ConvertGuildResult {
  readonly mode: 'convert';
  readonly status: ConvertStatus;
  readonly dryRun: boolean;
  readonly total: number;
  readonly stringTypedBefore: number;
  readonly numericStringBefore: number;
  readonly nonNumericString: number;
  readonly backupCollection: string | null;
  readonly modifiedCount: number;
  /** Convertible rows still String-typed after the run. 0 == success. */
  readonly numericStringAfter: number;
  readonly sample: readonly string[];
}

interface IndexGuildResult {
  readonly mode: 'index';
  readonly ensured: readonly string[];
}

type GuildResult = AuditGuildResult | ConvertGuildResult | IndexGuildResult;

interface GuildOutcome {
  readonly guildId: string;
  readonly ok: boolean;
  readonly result: GuildResult | null;
  readonly error: string | null;
}

/** Narrow `connection.db` to a resolved handle or fail loudly. */
const dbOf = (connection: Connection, guildId: string): GuildDb => {
  const db = connection.db;
  if (db === undefined) {
    throw new Error(`mongoose connection has no resolved db handle for guild ${guildId}`);
  }
  return db;
};

const auditGuild = async (db: GuildDb): Promise<AuditGuildResult> => {
  const collection = db.collection(MESSAGES_COLLECTION);
  const [total, stringTyped, numericString, nonNumericString, nullOrMissing] = await Promise.all([
    collection.countDocuments({}),
    collection.countDocuments(STRING_TYPED_FILTER),
    collection.countDocuments(NUMERIC_STRING_FILTER),
    collection.countDocuments(NON_NUMERIC_STRING_FILTER),
    collection.countDocuments(NULL_OR_MISSING_FILTER),
  ]);
  return { mode: 'audit', total, stringTyped, numericString, nonNumericString, nullOrMissing };
};

const sampleConvertibleIds = async (db: GuildDb, limit: number): Promise<string[]> => {
  if (limit === 0) return [];
  const docs = await db
    .collection(MESSAGES_COLLECTION)
    .find(NUMERIC_STRING_FILTER, { projection: { _id: 1 } })
    .limit(limit)
    .toArray();
  return docs.map((d) => String(d['_id']));
};

const convertGuild = async (
  db: GuildDb,
  config: MigrateConfig,
  nowMs: number,
): Promise<ConvertGuildResult> => {
  const collection = db.collection(MESSAGES_COLLECTION);
  const [total, stringTypedBefore, numericStringBefore, nonNumericString] = await Promise.all([
    collection.countDocuments({}),
    collection.countDocuments(STRING_TYPED_FILTER),
    collection.countDocuments(NUMERIC_STRING_FILTER),
    collection.countDocuments(NON_NUMERIC_STRING_FILTER),
  ]);

  const base = {
    mode: 'convert' as const,
    dryRun: config.dryRun,
    total,
    stringTypedBefore,
    numericStringBefore,
    nonNumericString,
  };

  if (config.dryRun) {
    return {
      ...base,
      status: 'dry-run',
      backupCollection: null,
      modifiedCount: 0,
      numericStringAfter: numericStringBefore,
      sample: await sampleConvertibleIds(db, config.sampleLimit),
    };
  }

  // Nothing convertible: either already clean, or only garbage rows that
  // are out of scope and need manual triage. Neither path writes.
  if (numericStringBefore === 0) {
    return {
      ...base,
      status: nonNumericString > 0 ? 'manual-triage-required' : 'already-clean',
      backupCollection: null,
      modifiedCount: 0,
      numericStringAfter: 0,
      sample: [],
    };
  }

  // Mandatory pre-conversion backup (fail-fast): full in-database snapshot
  // via `$out`, verified by a count match before any write to the source.
  const backupCollection = backupCollectionName(nowMs);
  await collection.aggregate([{ $match: {} }, { $out: backupCollection }]).toArray();
  const backupCount = await db.collection(backupCollection).countDocuments({});
  if (backupCount !== total) {
    throw new Error(
      `backup verification failed for db ${db.databaseName}: snapshot ${backupCollection} has ` +
        `${String(backupCount)} docs but source has ${String(total)} — aborting before any write`,
    );
  }

  const updateResult = await collection.updateMany(buildConvertFilter(), buildConvertPipeline());
  const numericStringAfter = await collection.countDocuments(NUMERIC_STRING_FILTER);

  return {
    ...base,
    status:
      numericStringAfter === 0 && nonNumericString === 0 ? 'converted' : 'manual-triage-required',
    backupCollection,
    modifiedCount: updateResult.modifiedCount,
    numericStringAfter,
    sample: [],
  };
};

const indexGuild = async (db: GuildDb): Promise<IndexGuildResult> => {
  const collection = db.collection(MESSAGES_COLLECTION);
  const ensured: string[] = [];
  for (const { name, spec } of buildIndexSpecs()) {
    // `createIndex` is a no-op when an identical index already exists, so
    // pre-building here and declaring the same index on the schema later
    // never conflicts.
    await collection.createIndex(spec, { name });
    ensured.push(name);
  }
  return { mode: 'index', ensured };
};

const runGuild = async (
  config: MigrateConfig,
  guildId: string,
  nowMs: number,
): Promise<GuildResult> => {
  const uri = buildGuildMongoUri(config.mongoUri, guildId);
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    const db = dbOf(connection, guildId);
    switch (config.mode) {
      case 'audit':
        return await auditGuild(db);
      case 'convert':
        return await convertGuild(db, config, nowMs);
      case 'index':
        return await indexGuild(db);
    }
  } finally {
    await connection.close();
  }
};

/** Whether the run, given its outcomes, should exit non-zero. */
const computeFailure = (config: MigrateConfig, outcomes: readonly GuildOutcome[]): boolean => {
  if (outcomes.some((o) => !o.ok)) return true;
  if (config.mode === 'convert' && !config.dryRun) {
    return outcomes.some(
      (o) =>
        o.result?.mode === 'convert' &&
        (o.result.numericStringAfter > 0 || o.result.nonNumericString > 0),
    );
  }
  return false;
};

/** One human-readable recommendation/summary line per mode. */
const summaryLine = (
  config: MigrateConfig,
  outcomes: readonly GuildOutcome[],
  failed: boolean,
): string => {
  if (config.mode === 'audit') {
    const needConvert = outcomes
      .filter((o) => o.result?.mode === 'audit' && o.result.numericString > 0)
      .map((o) => o.guildId);
    const needTriage = outcomes
      .filter((o) => o.result?.mode === 'audit' && o.result.nonNumericString > 0)
      .map((o) => o.guildId);
    if (needConvert.length === 0 && needTriage.length === 0) {
      return 'AUDIT: NO CONVERSION NEEDED — every guild has zero String-typed timestamps; proceed to index + code.';
    }
    const parts = [`AUDIT: CONVERSION REQUIRED for guilds [${needConvert.join(', ')}]`];
    if (needTriage.length > 0) {
      parts.push(`MANUAL TRIAGE (non-numeric strings) for guilds [${needTriage.join(', ')}]`);
    }
    return parts.join('; ');
  }
  if (config.mode === 'convert') {
    if (config.dryRun) {
      return 'CONVERT (dry-run): no writes performed; review the per-guild sample/counts above.';
    }
    return failed
      ? 'CONVERT: FAIL — one or more guilds left String-typed timestamps (manual triage) or errored; deploy gate stays CLOSED.'
      : 'CONVERT: PASS — every guild converted and verified clean; safe to proceed to index + deploy.';
  }
  return failed
    ? 'INDEX: FAIL — one or more guilds errored.'
    : 'INDEX: PASS — indexes ensured on every guild.';
};

const main = async (): Promise<void> => {
  // A one-shot ops tool must not pollute `logs/<bot>/...` with synthetic
  // records — `createBootstrapLogger` honours `LOG_DIR=''` as the toggle
  // that skips the file sink (matching verify_db / msg_backup).
  process.env['LOG_DIR'] = '';
  const logger = createBootstrapLogger({ component: 'migrate_timestamp' });

  const config = parseConfig(CONFIG_PATH);
  const nowMs = Date.now();
  logger.info(
    { mode: config.mode, dryRun: config.dryRun, guilds: config.guilds.length },
    'migrate_timestamp: start',
  );

  const outcomes: GuildOutcome[] = [];
  for (const guildId of config.guilds) {
    try {
      const result = await runGuild(config, guildId, nowMs);
      outcomes.push({ guildId, ok: true, result, error: null });
      logger.info({ guildId, result }, 'migrate_timestamp: guild done');
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      outcomes.push({ guildId, ok: false, result: null, error });
      logger.error({ guildId, error }, 'migrate_timestamp: guild failed');
    }
  }

  const failed = computeFailure(config, outcomes);
  const report = {
    mode: config.mode,
    dryRun: config.dryRun,
    generatedAt: new Date(nowMs).toISOString(),
    guilds: outcomes,
  };
  const serialised = `${JSON.stringify(report, null, 2)}\n`;
  if (config.outputPath !== null) {
    writeFileSync(config.outputPath, serialised, 'utf8');
    logger.info({ outputPath: config.outputPath }, 'migrate_timestamp: report written');
  } else {
    process.stdout.write(serialised);
  }

  process.stdout.write(`${summaryLine(config, outcomes, failed)}\n`);
  process.exitCode = failed ? 1 : 0;
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[migrate_timestamp] FAIL: ${message}\n`);
  process.exit(1);
});
