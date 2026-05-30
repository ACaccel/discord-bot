/**
 * Ops tool — verify the structural validity of a guild's `messages`
 * collection.
 *
 * Read-only by design. Runs a fixed battery of checks against the
 * collection and produces a JSON report. Replaces the older single-
 * purpose `inspect-null-message-ids.ts`; "messageId is null" is now
 * one of the eight checks below rather than the whole tool.
 *
 * Configuration
 * -------------
 * All inputs come from `tools/verify_db/config.json` (gitignored —
 * never commit operator credentials). No CLI args. The config schema
 * is documented in the sibling `config.example.json` and validated
 * at startup by `internal.parseConfig`; missing or malformed fields
 * fail-fast with a structured `ConfigurationError`.
 *
 * Checks
 * ------
 *   - `messageId-null`         documents with `messageId === null`
 *   - `messageId-empty-string` documents with `messageId === ''`
 *   - `messageId-duplicate`    distinct non-null `messageId`s with > 1 doc
 *   - `channelId-missing`      `channelId` null or empty
 *   - `userId-missing`         `userId` null or empty
 *   - `userName-missing`       `userName` null or empty
 *   - `timestamp-invalid`      `timestamp` non-numeric or <= 0
 *   - `total-count`            informational; never a violation
 *
 * Output
 * ------
 * JSON report to stdout (or `output_path` if set), plus a final
 * `PASS` / `FAIL` line. Exit code is 0 when every check has zero
 * violations, 1 otherwise. The duplicate check additionally emits the
 * offending `messageId` values and their counts under
 * `duplicateGroups`.
 *
 * Authentication
 * --------------
 * `internal.buildGuildUri` defaults `authSource=admin` when the
 * operator-supplied `mongo_uri` omits it — matching the bot's
 * `buildGuildMongoUri`.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import mongoose, { type Connection } from 'mongoose';

import { createBootstrapLogger } from '../../src/core/config';

import { buildGuildUri, createProgressWriter, parseConfig } from './internal';

const CONTENT_PREVIEW_LENGTH = 50;
const CONFIG_PATH = resolve(__dirname, 'config.json');

interface SampleDoc {
  readonly _id: string;
  readonly value: unknown;
  readonly channelId: string | undefined;
  readonly userId: string | undefined;
  readonly timestamp: number | undefined;
  readonly contentPreview: string;
}

interface CheckSampleResult {
  readonly name: string;
  readonly violationCount: number;
  readonly sample: readonly SampleDoc[];
}

interface CheckDuplicateResult {
  readonly name: 'messageId-duplicate';
  readonly violationCount: number;
  readonly duplicateGroups: ReadonlyArray<{ readonly messageId: string; readonly count: number }>;
}

interface CheckTotalResult {
  readonly name: 'total-count';
  readonly violationCount: 0;
  readonly totalCount: number;
}

type CheckResult = CheckSampleResult | CheckDuplicateResult | CheckTotalResult;

interface Report {
  readonly guildId: string;
  readonly totalCount: number;
  readonly checks: readonly CheckResult[];
}

const previewContent = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  return raw.slice(0, CONTENT_PREVIEW_LENGTH);
};

const toSample = (doc: Record<string, unknown>, violationField: string): SampleDoc => ({
  _id: String(doc['_id']),
  value: doc[violationField],
  channelId: typeof doc['channelId'] === 'string' ? doc['channelId'] : undefined,
  userId: typeof doc['userId'] === 'string' ? doc['userId'] : undefined,
  timestamp: typeof doc['timestamp'] === 'number' ? doc['timestamp'] : undefined,
  contentPreview: previewContent(doc['content']),
});

interface FilterCheck {
  readonly name: string;
  readonly violationField: string;
  readonly filter: Record<string, unknown>;
}

/**
 * Each filter-based check shares the same shape: count + sample. The
 * `violationField` names the field whose value the sample echoes back
 * so the operator can spot the actual offending value.
 */
const FILTER_CHECKS: readonly FilterCheck[] = [
  { name: 'messageId-null', violationField: 'messageId', filter: { messageId: null } },
  { name: 'messageId-empty-string', violationField: 'messageId', filter: { messageId: '' } },
  {
    name: 'channelId-missing',
    violationField: 'channelId',
    filter: { $or: [{ channelId: null }, { channelId: '' }] },
  },
  {
    name: 'userId-missing',
    violationField: 'userId',
    filter: { $or: [{ userId: null }, { userId: '' }] },
  },
  {
    name: 'userName-missing',
    violationField: 'userName',
    filter: { $or: [{ userName: null }, { userName: '' }] },
  },
  {
    name: 'timestamp-invalid',
    violationField: 'timestamp',
    filter: {
      $or: [{ timestamp: { $not: { $type: 'number' } } }, { timestamp: { $lte: 0 } }],
    },
  },
];

const runFilterCheck = async (
  connection: Connection,
  check: FilterCheck,
  sampleLimit: number,
): Promise<CheckSampleResult> => {
  const db = connection.db;
  if (db === undefined) {
    throw new Error('mongoose connection has no resolved db handle');
  }
  const collection = db.collection('messages');
  const violationCount = await collection.countDocuments(check.filter);
  const rawSample =
    sampleLimit === 0
      ? []
      : ((await collection.find(check.filter).limit(sampleLimit).toArray()) as Array<
          Record<string, unknown>
        >);
  return {
    name: check.name,
    violationCount,
    sample: rawSample.map((doc) => toSample(doc, check.violationField)),
  };
};

const runDuplicateCheck = async (
  connection: Connection,
  sampleLimit: number,
): Promise<CheckDuplicateResult> => {
  const db = connection.db;
  if (db === undefined) {
    throw new Error('mongoose connection has no resolved db handle');
  }
  const collection = db.collection('messages');
  // Aggregate over non-null messageIds; a null `messageId` is its own
  // dedicated check above and would otherwise dominate the duplicate
  // bucket with a single giant group that obscures real dup pairs.
  //
  // Single pass: fetch ALL dup groups sorted by count desc, then derive
  // violationCount (sum of excess docs per group) and the top-N sample
  // in JS. Previously this ran two server-side aggregations; the second
  // pass for the total was redundant since the first already had the
  // data once `$limit` is removed. Halves cluster load on large
  // collections at the cost of holding all dup groups in process memory
  // (each group is `{_id: string, count: number}` — negligible).
  type DupGroup = { readonly _id: string; readonly count: number };
  const allGroups = (await collection
    .aggregate([
      { $match: { messageId: { $ne: null } } },
      { $group: { _id: '$messageId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray()) as DupGroup[];
  const violationCount = allGroups.reduce((acc, g) => acc + (g.count - 1), 0);
  const sampleGroups = sampleLimit > 0 ? allGroups.slice(0, sampleLimit) : allGroups;
  return {
    name: 'messageId-duplicate',
    violationCount,
    duplicateGroups: sampleGroups.map((g) => ({ messageId: g._id, count: g.count })),
  };
};

/**
 * In-place progress reporter — writes to stderr so the stdout JSON
 * report stays uncluttered. The TTY-aware writer factory lives in
 * `internal.ts`; this module just binds it to `process.stderr`.
 */
const writeProgress = createProgressWriter(
  {
    write: (text: string): void => {
      process.stderr.write(text);
    },
  },
  process.stderr.isTTY === true,
);

const runAllChecks = async (
  connection: Connection,
  guildId: string,
  sampleLimit: number,
): Promise<Report> => {
  const db = connection.db;
  if (db === undefined) {
    throw new Error(`mongoose connection has no resolved db handle for guild ${guildId}`);
  }
  const collection = db.collection('messages');

  // Build the ordered list of checks (filter checks interleaved with
  // the duplicate aggregation at its canonical slot) so progress
  // numbering matches output ordering. `+ 1` for total-count tail.
  type Step =
    | { readonly kind: 'filter'; readonly check: FilterCheck }
    | { readonly kind: 'duplicate' }
    | { readonly kind: 'total' };
  const steps: Step[] = [];
  for (const check of FILTER_CHECKS) {
    steps.push({ kind: 'filter', check });
    if (check.name === 'messageId-empty-string') {
      steps.push({ kind: 'duplicate' });
    }
  }
  steps.push({ kind: 'total' });
  const totalSteps = steps.length;

  const fmtElapsed = (startMs: number): string => `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
  const stepName = (s: Step): string =>
    s.kind === 'filter'
      ? s.check.name
      : s.kind === 'duplicate'
        ? 'messageId-duplicate'
        : 'total-count';

  const checks: CheckResult[] = [];
  let totalCount = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Step;
    const idx = i + 1;
    const name = stepName(step);
    const startedAt = Date.now();
    writeProgress(`[${idx}/${totalSteps}] ${name}... running`, false);
    let violationCount = 0;
    if (step.kind === 'filter') {
      const result = await runFilterCheck(connection, step.check, sampleLimit);
      checks.push(result);
      violationCount = result.violationCount;
    } else if (step.kind === 'duplicate') {
      const result = await runDuplicateCheck(connection, sampleLimit);
      checks.push(result);
      violationCount = result.violationCount;
    } else {
      totalCount = await collection.countDocuments({});
      checks.push({ name: 'total-count', violationCount: 0, totalCount });
    }
    const elapsed = fmtElapsed(startedAt);
    const detail =
      step.kind === 'total' ? `${String(totalCount)} docs` : `${String(violationCount)} violations`;
    writeProgress(`[${idx}/${totalSteps}] ${name} done in ${elapsed} (${detail})`, true);
  }

  return { guildId, totalCount, checks };
};

const main = async (): Promise<void> => {
  // Force-disable the file-router sink for this ops invocation —
  // a one-shot read-only verifier must not pollute `logs/<bot>/...`
  // with synthetic, bot-less records. `createBootstrapLogger` honours
  // `LOG_DIR=''` as the explicit toggle that skips the file sink.
  process.env['LOG_DIR'] = '';
  const logger = createBootstrapLogger({ component: 'verify_db' });

  const config = parseConfig(CONFIG_PATH);
  const guildUri = buildGuildUri(config.mongoUri, config.guildId);

  logger.info(
    { guildId: config.guildId, sampleLimit: config.sampleLimit },
    'verify_db: connecting',
  );

  const connection = await mongoose.createConnection(guildUri).asPromise();
  let report: Report;
  try {
    report = await runAllChecks(connection, config.guildId, config.sampleLimit);
  } finally {
    await connection.close();
  }

  const serialised = `${JSON.stringify(report, null, 2)}\n`;
  if (config.outputPath !== null) {
    writeFileSync(config.outputPath, serialised, 'utf8');
    logger.info({ outputPath: config.outputPath }, 'verify_db: results written');
  } else {
    process.stdout.write(serialised);
  }

  const totalViolations = report.checks.reduce((acc, c) => acc + c.violationCount, 0);
  if (totalViolations === 0) {
    process.stdout.write('PASS\n');
    process.exitCode = 0;
  } else {
    process.stdout.write(`FAIL (${String(totalViolations)} violations across all checks)\n`);
    process.exitCode = 1;
  }
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[verify_db] FAIL: ${message}\n`);
  process.exit(1);
});
