/**
 * Pure, unit-testable internals for `migrate_timestamp`. The process
 * entry point (`migrate_timestamp.ts`) owns the mongoose lifecycle,
 * per-guild orchestration, backup, and exit-code wiring; the helpers
 * here are referentially transparent given their arguments so
 * `migrate_timestamp.test.ts` can exercise them without booting Mongo.
 *
 * Context: the `Message.timestamp` field is logically epoch-ms but was
 * stored as a String under the pre-refactor schema, so legacy rows may
 * hold String values while every current write is numeric. This tool
 * audits, converts (String → numeric), and indexes the field so the
 * `MessageRepo` range queries can drop `$toLong` and become index-served.
 * See `tools/migrate_timestamp/README.md` for the full runbook.
 */
import { readFileSync } from 'node:fs';

import { ConfigurationError } from '../../src/core/errors/configuration-error';

// ---------- Config ----------

/** The three phases of the migration, selected per run via config. */
export type MigrateMode = 'audit' | 'convert' | 'index';

export const MIGRATE_MODES: readonly MigrateMode[] = ['audit', 'convert', 'index'];

export interface MigrateConfig {
  /**
   * Base MongoDB URI normalised to host-with-trailing-slash form
   * (query string stripped), as `buildGuildMongoUri` expects.
   */
  readonly mongoUri: string;
  /** All-digit guild ids; each is a separate per-guild database. */
  readonly guilds: readonly string[];
  readonly mode: MigrateMode;
  /** `convert` only: count + sample what would change, write nothing. */
  readonly dryRun: boolean;
  /** Cap on `_id`/value samples echoed back in reports. */
  readonly sampleLimit: number;
  /** Write the JSON report here instead of stdout when set. */
  readonly outputPath: string | null;
}

const isMigrateMode = (value: unknown): value is MigrateMode =>
  typeof value === 'string' && (MIGRATE_MODES as readonly string[]).includes(value);

const configError = (configPath: string, field: string, reason: string): ConfigurationError =>
  new ConfigurationError({
    code: 'INVALID_CONFIG_JSON',
    messageKey: 'errors:config.invalid',
    context: {
      operation: 'migrate_timestamp.parseConfig',
      input: { configPath, field, reason },
    },
  });

/**
 * Parse the operator-supplied `config.json`. Path is injected so unit
 * tests can point at fixture files rather than the gitignored real
 * config. `mongo_uri` is normalised to the host-with-trailing-slash
 * shape `buildGuildMongoUri` expects — any query string is stripped and
 * a single trailing slash re-asserted, matching `msg_backup.parseConfig`.
 */
export const parseConfig = (configPath: string): MigrateConfig => {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigurationError({
      code: 'MISSING_ENV',
      messageKey: 'errors:config.missing',
      context: {
        operation: 'migrate_timestamp.parseConfig',
        input: { configPath, reason },
      },
      cause: err instanceof Error ? err : undefined,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new ConfigurationError({
      code: 'INVALID_CONFIG_JSON',
      messageKey: 'errors:config.invalid',
      context: {
        operation: 'migrate_timestamp.parseConfig',
        input: { configPath, reason: 'malformed JSON' },
      },
      cause: err instanceof Error ? err : undefined,
    });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw configError(configPath, '<root>', 'must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;

  const rawMongoUri = obj['mongo_uri'];
  if (typeof rawMongoUri !== 'string' || rawMongoUri.length === 0) {
    throw configError(configPath, 'mongo_uri', 'must be a non-empty string');
  }
  const mongoUriHost = rawMongoUri.split('?', 1)[0] ?? rawMongoUri;
  const mongoUri = `${mongoUriHost.replace(/\/+$/, '')}/`;

  const guildsRaw = obj['guilds'];
  if (!Array.isArray(guildsRaw) || guildsRaw.length === 0) {
    throw configError(configPath, 'guilds', 'must be a non-empty array of guild id strings');
  }
  const guilds: string[] = [];
  for (const g of guildsRaw) {
    if (typeof g !== 'string' || !/^\d+$/.test(g)) {
      throw configError(
        configPath,
        'guilds[]',
        `each entry must be an all-digit string, got ${String(g)}`,
      );
    }
    guilds.push(g);
  }

  const modeRaw = obj['mode'];
  if (!isMigrateMode(modeRaw)) {
    throw configError(configPath, 'mode', `must be one of: ${MIGRATE_MODES.join(', ')}`);
  }
  const mode = modeRaw;

  let dryRun = false;
  const dryRunRaw = obj['dry_run'];
  if (dryRunRaw !== undefined) {
    if (typeof dryRunRaw !== 'boolean') {
      throw configError(configPath, 'dry_run', 'must be a boolean');
    }
    dryRun = dryRunRaw;
  }

  let sampleLimit = 20;
  const sampleLimitRaw = obj['sample_limit'];
  if (sampleLimitRaw !== undefined && sampleLimitRaw !== null) {
    if (
      typeof sampleLimitRaw !== 'number' ||
      !Number.isInteger(sampleLimitRaw) ||
      sampleLimitRaw < 0
    ) {
      throw configError(configPath, 'sample_limit', 'must be a non-negative integer');
    }
    sampleLimit = sampleLimitRaw;
  }

  let outputPath: string | null = null;
  const outputPathRaw = obj['output_path'];
  if (outputPathRaw !== undefined && outputPathRaw !== null) {
    if (typeof outputPathRaw !== 'string' || outputPathRaw.length === 0) {
      throw configError(configPath, 'output_path', 'must be null or a non-empty string');
    }
    outputPath = outputPathRaw;
  }

  return { mongoUri, guilds, mode, dryRun, sampleLimit, outputPath };
};

// ---------- Query / pipeline builders ----------

/**
 * The audit buckets. `string-typed` is the migration's scope; a row is
 * convertible only when it is also `numeric-string`. `non-numeric-string`
 * are garbage rows routed to manual triage (never auto-converted). The
 * regex is anchored digits-only so an empty or sign-prefixed string is
 * treated as garbage, not a timestamp.
 */
export const STRING_TYPED_FILTER: Readonly<Record<string, unknown>> = {
  timestamp: { $type: 'string' },
};

/** Convertible legacy rows: String-typed AND all-digit. */
export const NUMERIC_STRING_FILTER: Readonly<Record<string, unknown>> = {
  timestamp: { $type: 'string', $regex: /^[0-9]+$/ },
};

/** Garbage rows: String-typed but not all-digit. Manual triage only. */
export const NON_NUMERIC_STRING_FILTER: Readonly<Record<string, unknown>> = {
  timestamp: { $type: 'string', $not: /^[0-9]+$/ },
};

/** Informational: `{ timestamp: null }` also matches a missing field. */
export const NULL_OR_MISSING_FILTER: Readonly<Record<string, unknown>> = {
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

export interface IndexSpec {
  readonly name: string;
  readonly spec: Readonly<Record<string, 1>>;
}

/**
 * Indexes the timestamp migration adds. `{ timestamp: 1 }` serves the
 * cross-channel range query (`findByTimestampRange`); the compound
 * `{ channelId: 1, timestamp: 1 }` serves the per-channel range query
 * and its sort (`findByChannelAndTimestampRange`, `findRecentByChannel`).
 * Names are pinned so they match the mongoose-built indexes from the
 * schema declarations and `createIndex` stays a no-op on re-run.
 */
export const buildIndexSpecs = (): readonly IndexSpec[] => [
  { name: 'timestamp_1', spec: { timestamp: 1 } },
  { name: 'channelId_1_timestamp_1', spec: { channelId: 1, timestamp: 1 } },
];
