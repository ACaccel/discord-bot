/**
 * `db migrate-timestamp` — migrate the `Message.timestamp` field to a
 * uniform numeric type across every guild database, so the `MessageRepo`
 * range queries can drop the non-sargable `$toLong` predicate and become
 * index-served.
 *
 * Three modes (selected via the `operations.migrate-timestamp.mode`
 * config field):
 *   - `audit`   read-only. Per guild, count String-typed / numeric-string
 *               / non-numeric-string / null-or-missing timestamps and
 *               print a fleet recommendation. ALWAYS exits 0.
 *   - `convert` write. For each guild with convertible rows: take a
 *               mandatory in-database snapshot (fail-fast — no backup, no
 *               convert), run the String → numeric `updateMany`, then
 *               re-verify the convertible count is 0. `dry_run: true`
 *               counts + samples without writing. Exits 1 if any guild is
 *               left non-clean or fails.
 *   - `index`   write. Build `{ timestamp: 1 }` and
 *               `{ channelId: 1, timestamp: 1 }` per guild (idempotent).
 *
 * Per-guild failure isolation (via `runPerGuild`): one guild's failure
 * never aborts the rest of the fleet; re-runs are idempotent. See the
 * unified README for the full runbook and the hard gate: the
 * numeric-timestamp repo predicate must not ship until every guild
 * reports zero String-typed timestamps.
 */
import type { Connection } from 'mongoose';
import { z } from 'zod';

import { defineCommand, type DbCommandResult } from '../framework/command';
import { runPerGuild, type GuildOutcome } from '../framework/guild-runner';

const MESSAGES_COLLECTION = 'messages';

// Derive the resolved db handle from mongoose's own `Connection` type so the
// tool does not take a direct dependency on the `mongodb` driver package (it
// is only a transitive dependency of mongoose).
type GuildDb = NonNullable<Connection['db']>;

/** The three phases of the migration, selected per run via config. */
type MigrateMode = 'audit' | 'convert' | 'index';

export const MIGRATE_MODES: readonly MigrateMode[] = ['audit', 'convert', 'index'];

export const migrateTimestampOptionsSchema = z.object({
  mode: z.enum(['audit', 'convert', 'index']),
  dry_run: z.boolean().default(false),
  sample_limit: z.number().int().min(0).default(20),
});

type MigrateOptions = z.infer<typeof migrateTimestampOptionsSchema>;

// ---------- Query / pipeline builders ----------

/**
 * The audit buckets. `string-typed` is the migration's scope; a row is
 * convertible only when it is also `numeric-string`. `non-numeric-string`
 * are garbage rows routed to manual triage (never auto-converted). The
 * regex is anchored digits-only so an empty or sign-prefixed string is
 * treated as garbage, not a timestamp.
 */
const STRING_TYPED_FILTER: Readonly<Record<string, unknown>> = {
  timestamp: { $type: 'string' },
};

/** Convertible legacy rows: String-typed AND all-digit. */
const NUMERIC_STRING_FILTER: Readonly<Record<string, unknown>> = {
  timestamp: { $type: 'string', $regex: /^[0-9]+$/ },
};

/** Garbage rows: String-typed but not all-digit. Manual triage only. */
const NON_NUMERIC_STRING_FILTER: Readonly<Record<string, unknown>> = {
  timestamp: { $type: 'string', $not: /^[0-9]+$/ },
};

/** Informational: `{ timestamp: null }` also matches a missing field. */
const NULL_OR_MISSING_FILTER: Readonly<Record<string, unknown>> = {
  timestamp: null,
};

/** The match filter for the conversion `updateMany` — convertible rows only. */
export const buildConvertFilter = (): Record<string, unknown> => ({
  timestamp: { $type: 'string', $regex: /^[0-9]+$/ },
});

/**
 * The aggregation-pipeline update body. The pipeline form is required to
 * reference the field's own value. `$convert` with `onError: '$timestamp'`
 * leaves a value unchanged if it cannot be coerced (e.g. an int64
 * overflow) rather than aborting the whole batch — such a row stays
 * String and is caught by the post-conversion verify count.
 */
export const buildConvertPipeline = (): Record<string, unknown>[] => [
  {
    $set: {
      timestamp: {
        $convert: { input: '$timestamp', to: 'long', onError: '$timestamp' },
      },
    },
  },
];

/**
 * Per-guild in-database snapshot name for the mandatory pre-conversion
 * backup. Encodes a sortable UTC timestamp so repeated runs never
 * overwrite an earlier snapshot. Colons/dots are replaced so the name is
 * a valid MongoDB collection identifier.
 */
export const backupCollectionName = (nowMs: number): string => {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  return `messages_backup_pre_ts_${stamp}`;
};

interface IndexSpec {
  readonly name: string;
  readonly spec: Readonly<Record<string, 1>>;
}

/**
 * Indexes the timestamp migration adds. `{ timestamp: 1 }` serves the
 * cross-channel range query (`findByTimestampRange`); the compound
 * `{ channelId: 1, timestamp: 1 }` serves the per-channel range query and
 * its sort (`findByChannelAndTimestampRange`, `findRecentByChannel`).
 * Names are pinned so they match the mongoose-built indexes from the
 * schema declarations and `createIndex` stays a no-op on re-run.
 */
export const buildIndexSpecs = (): readonly IndexSpec[] => [
  { name: 'timestamp_1', spec: { timestamp: 1 } },
  { name: 'channelId_1_timestamp_1', spec: { channelId: 1, timestamp: 1 } },
];

// ---------- Per-guild mode handlers ----------

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
  options: MigrateOptions,
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
    dryRun: options.dry_run,
    total,
    stringTypedBefore,
    numericStringBefore,
    nonNumericString,
  };

  if (options.dry_run) {
    return {
      ...base,
      status: 'dry-run',
      backupCollection: null,
      modifiedCount: 0,
      numericStringAfter: numericStringBefore,
      sample: await sampleConvertibleIds(db, options.sample_limit),
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

const runMode = (db: GuildDb, options: MigrateOptions, nowMs: number): Promise<GuildResult> => {
  switch (options.mode) {
    case 'audit':
      return auditGuild(db);
    case 'convert':
      return convertGuild(db, options, nowMs);
    case 'index':
      return indexGuild(db);
  }
};

/** Whether the run, given its outcomes, should exit non-zero. */
export const computeFailure = (
  options: MigrateOptions,
  outcomes: readonly GuildOutcome<GuildResult>[],
): boolean => {
  if (outcomes.some((o) => !o.ok)) return true;
  if (options.mode === 'convert' && !options.dry_run) {
    return outcomes.some(
      (o) =>
        o.result?.mode === 'convert' &&
        (o.result.numericStringAfter > 0 || o.result.nonNumericString > 0),
    );
  }
  return false;
};

/** One human-readable recommendation/summary line per mode. */
export const summaryLine = (
  options: MigrateOptions,
  outcomes: readonly GuildOutcome<GuildResult>[],
  failed: boolean,
): string => {
  if (options.mode === 'audit') {
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
  if (options.mode === 'convert') {
    if (options.dry_run) {
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

export const migrateTimestampCommand = defineCommand<MigrateOptions>({
  name: 'migrate-timestamp',
  description: 'Migrate Message.timestamp String -> numeric (modes: audit | convert | index).',
  optionsSchema: migrateTimestampOptionsSchema,
  run: async ({ shared, options, logger, withGuildConnection }): Promise<DbCommandResult> => {
    const nowMs = Date.now();
    logger.info(
      { mode: options.mode, dryRun: options.dry_run, guilds: shared.guilds.length },
      'db migrate-timestamp: start',
    );

    const outcomes = await runPerGuild<GuildResult>(
      shared.guilds,
      (guildId) =>
        withGuildConnection(guildId, (connection) =>
          runMode(dbOf(connection, guildId), options, nowMs),
        ),
      logger,
      'db migrate-timestamp',
    );

    const failed = computeFailure(options, outcomes);
    const report = {
      mode: options.mode,
      dryRun: options.dry_run,
      generatedAt: new Date(nowMs).toISOString(),
      guilds: outcomes,
    };
    return {
      report,
      summaryLine: summaryLine(options, outcomes, failed),
      exitCode: failed ? 1 : 0,
    };
  },
});
