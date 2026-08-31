/**
 * Pure-text run-log writer for `msg_backup`.
 *
 * Produces the human-readable single-file run log an operator reads
 * after a backup. Lives next to the tool, not under
 * `src/core/logger/**`, because the format is tightly coupled to one
 * ops workflow and has no reusable contract with the rest of the
 * codebase.
 *
 * Design notes
 * ------------
 *   - Single file per process invocation. The filename is pinned at
 *     construction time using local-time `YYYY-MM-DD_HH-MM-SS` so the
 *     same run keeps writing to the same file even across day rollover.
 *   - `append` is synchronous (`writeSync`) for deterministic ordering
 *     against the parallel pino-pretty stdout. Throughput is not a
 *     concern: at peak, a handful of lines per second.
 *   - Every write is wrapped in try/catch. On the first I/O
 *     failure we fall back to `console.error`, set `broken=true`, and
 *     subsequent calls no-op the file write while still mirroring to
 *     stderr. `wasBroken()` reports the final state so `main()` can
 *     print an audible warning.
 *   - All formatting helpers are pure functions returning the multi-
 *     line text block as a single string with a trailing newline. The
 *     `msg_backup.ts` orchestrator picks the call site for each block.
 */
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const SEPARATOR_WIDTH = 65;
const MAIN_SEPARATOR = '='.repeat(SEPARATOR_WIDTH);
const CHANNEL_SEPARATOR = '-'.repeat(SEPARATOR_WIDTH);

/**
 * Format a local-time `Date` as `YYYY-MM-DD HH:MM:SS`. Used for the
 * header / footer "Started" / "Finished" lines.
 */
const formatFullLocal = (d: Date): string => {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
};

/**
 * Format a local-time `Date` as `[HH:MM:SS]` — the per-event time
 * stamp prefix for in-channel progress lines.
 */
export const formatTimestamp = (d: Date = new Date()): string => {
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `[${h}:${mi}:${s}]`;
};

/** Build a `YYYY-MM-DD_HH-MM-SS` slug for use in a filename. */
const filenameStamp = (d: Date): string => {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da}_${h}-${mi}-${s}`;
};

/**
 * Format the host machine's current timezone offset as `UTC+H` /
 * `UTC-H[:MM]`. JavaScript's `getTimezoneOffset()` returns minutes
 * WEST of UTC (e.g. `-480` for UTC+8), so the sign is inverted here.
 */
export const formatServerTimezone = (d: Date = new Date()): string => {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0
    ? `UTC${sign}${String(h)}`
    : `UTC${sign}${String(h)}:${String(m).padStart(2, '0')}`;
};

/**
 * Replace the password portion of a `mongodb://user:pass@host/...`
 * URI with `****`. Used to avoid leaking credentials into the log
 * file. Tolerates URIs without credentials (returns unchanged).
 */
export const maskMongoUri = (uri: string): string =>
  uri.replace(/^(mongodb(?:\+srv)?:\/\/[^:@/]+:)([^@]*)(@)/i, '$1****$3');

/** Format an elapsed millisecond duration as `HHh MMm SSs` / `MMmSSs` / `SSs`. */
const formatElapsed = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h)}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  if (m > 0) {
    return `${String(m)}m${String(s).padStart(2, '0')}s`;
  }
  return `${String(s)}s`;
};

const formatNumber = (n: number): string => n.toLocaleString('en-US');

/** Right-align a numeric value inside a fixed-width column. */
const padNumber = (n: number, width: number): string => formatNumber(n).padStart(width);

interface ConfigHeaderInput {
  readonly startedAt: Date;
  readonly mongoUri: string;
  readonly guilds: readonly string[];
  readonly startDate: string | undefined;
  readonly deleteBotMessages: boolean;
  readonly batchSize: number;
}

export const formatConfigHeader = (input: ConfigHeaderInput): string => {
  const startDateLine =
    input.startDate === undefined ? '(no lower bound — full backfill)' : input.startDate;
  return [
    MAIN_SEPARATOR,
    ' msg_backup execution',
    ` Started: ${formatFullLocal(input.startedAt)} (local)`,
    ` Server timezone: ${formatServerTimezone(input.startedAt)}`,
    ' Config:',
    `   - mongo_uri: ${maskMongoUri(input.mongoUri)}`,
    `   - guilds: [${input.guilds.join(', ')}]`,
    `   - start_date: ${startDateLine}`,
    `   - delete_bot_messages: ${String(input.deleteBotMessages)}`,
    `   - batch_size: ${String(input.batchSize)}`,
    MAIN_SEPARATOR,
    '',
  ].join('\n');
};

export const formatGuildBanner = (guildId: string, guildName: string): string =>
  [MAIN_SEPARATOR, ` Guild ${guildId} (${guildName})`, MAIN_SEPARATOR, ''].join('\n');

/**
 * Per-check tallies for the cleanup pass. Each numeric field counts
 * documents deleted by that check. `errors[checkName] = reason` is
 * populated when a check itself threw — in that case the
 * corresponding count stays at `0` and the summary line is rendered as
 * `ERROR (<reason>)`.
 */
export interface CleanupCounts {
  readonly messageIdNullOrEmpty: number;
  readonly messageIdDuplicate: number;
  readonly channelIdMissing: number;
  readonly userIdMissing: number;
  readonly userNameMissing: number;
  readonly timestampInvalid: number;
  readonly totalCount: number;
  readonly errors: Readonly<Record<string, string>>;
}

export const cleanupTotal = (c: CleanupCounts): number =>
  c.messageIdNullOrEmpty +
  c.messageIdDuplicate +
  c.channelIdMissing +
  c.userIdMissing +
  c.userNameMissing +
  c.timestampInvalid;

const CLEANUP_NUM_WIDTH = 13;

const cleanupValue = (
  counts: CleanupCounts,
  key: keyof CleanupCounts,
  rendered: string,
): string => {
  const reason = counts.errors[key as string];
  if (reason !== undefined) {
    return `ERROR (${reason})`;
  }
  return rendered;
};

export const formatCleanupSummary = (counts: CleanupCounts): string => {
  const lines = [
    '[Cleanup] Purging invalid documents...',
    `  - messageId null/empty:    ${cleanupValue(counts, 'messageIdNullOrEmpty', `${padNumber(counts.messageIdNullOrEmpty, CLEANUP_NUM_WIDTH)} deleted`)}`,
    `  - messageId duplicates:    ${cleanupValue(counts, 'messageIdDuplicate', `${padNumber(counts.messageIdDuplicate, CLEANUP_NUM_WIDTH)} deleted`)}`,
    `  - channelId null/empty:    ${cleanupValue(counts, 'channelIdMissing', `${padNumber(counts.channelIdMissing, CLEANUP_NUM_WIDTH)} deleted`)}`,
    `  - userId null/empty:       ${cleanupValue(counts, 'userIdMissing', `${padNumber(counts.userIdMissing, CLEANUP_NUM_WIDTH)} deleted`)}`,
    `  - userName null/empty:     ${cleanupValue(counts, 'userNameMissing', `${padNumber(counts.userNameMissing, CLEANUP_NUM_WIDTH)} deleted`)}`,
    `  - timestamp invalid:       ${cleanupValue(counts, 'timestampInvalid', `${padNumber(counts.timestampInvalid, CLEANUP_NUM_WIDTH)} deleted`)}`,
    `  - total messages in DB:    ${cleanupValue(counts, 'totalCount', `${padNumber(counts.totalCount, CLEANUP_NUM_WIDTH)} (after purge)`)}`,
    `  Total purged: ${formatNumber(cleanupTotal(counts))}`,
    '',
  ];
  return lines.join('\n');
};

export interface DiscoveredChannelInfo {
  readonly index: number; // 1-based, global across all categories
  readonly name: string;
  readonly id: string;
  readonly type: string;
  readonly parentName?: string;
}

interface ChannelDiscoveryInput {
  readonly total: number;
  readonly parents: readonly DiscoveredChannelInfo[];
  readonly activeThreads: readonly DiscoveredChannelInfo[];
  readonly archivedThreads: readonly DiscoveredChannelInfo[];
}

const formatChannelList = (
  heading: string,
  items: readonly DiscoveredChannelInfo[],
  withParent: boolean,
): readonly string[] => {
  if (items.length === 0) return [];
  const out: string[] = [`  ${heading} (${String(items.length)}):`];
  for (const it of items) {
    const namePart = it.name.padEnd(28);
    const suffix = withParent
      ? `(id: ${it.id}, parent: ${it.parentName ?? '<unknown>'})`
      : `(id: ${it.id}, type: ${it.type})`;
    out.push(`    ${String(it.index)}. ${namePart} ${suffix}`);
  }
  return out;
};

export const formatChannelDiscovery = (input: ChannelDiscoveryInput): string => {
  const lines: string[] = [
    `[Channel discovery] Found ${String(input.total)} fetchable text channels (incl. threads & forum posts):`,
    ...formatChannelList('Parent channels', input.parents, false),
    ...formatChannelList('Active threads', input.activeThreads, true),
    ...formatChannelList('Archived threads', input.archivedThreads, true),
    '',
  ];
  return lines.join('\n');
};

export const formatChannelHeader = (
  index: number,
  total: number,
  name: string,
  id: string,
): string =>
  [
    CHANNEL_SEPARATOR,
    ` (${String(index)}/${String(total)}) Channel: ${name} (id: ${id})`,
    CHANNEL_SEPARATOR,
  ].join('\n');

interface MonthLineInput {
  readonly month: string;
  readonly processed: number;
  readonly upserted: number;
  readonly botDeleted: number;
  readonly skippedNullAuthor: number;
  readonly skippedAttachments: number;
  readonly skippedReactions: number;
  readonly skippedStickers: number;
}

export const formatMonthLine = (input: MonthLineInput): string =>
  `${formatTimestamp()} Month ${input.month}: ` +
  `processed ${formatNumber(input.processed)}, ` +
  `upserted ${formatNumber(input.upserted)}, ` +
  `bot-deleted ${formatNumber(input.botDeleted)}, ` +
  `skipped-null-author ${formatNumber(input.skippedNullAuthor)}, ` +
  `skipped-attachments ${formatNumber(input.skippedAttachments)}, ` +
  `skipped-reactions ${formatNumber(input.skippedReactions)}, ` +
  `skipped-stickers ${formatNumber(input.skippedStickers)}`;

interface ChannelSummaryInput {
  readonly processed: number;
  readonly upserted: number;
  readonly botDeleted: number;
  readonly skippedNullAuthor: number;
  readonly skippedAttachments: number;
  readonly skippedReactions: number;
  readonly skippedStickers: number;
  readonly elapsedMs: number;
}

export const formatChannelSummary = (input: ChannelSummaryInput): string =>
  `${formatTimestamp()} Channel done. ` +
  `Total processed: ${formatNumber(input.processed)}  ` +
  `upserted: ${formatNumber(input.upserted)}  ` +
  `bot-deleted: ${formatNumber(input.botDeleted)}  ` +
  `skipped-null-author: ${formatNumber(input.skippedNullAuthor)}  ` +
  `skipped-attachments: ${formatNumber(input.skippedAttachments)}  ` +
  `skipped-reactions: ${formatNumber(input.skippedReactions)}  ` +
  `skipped-stickers: ${formatNumber(input.skippedStickers)}  ` +
  `elapsed: ${formatElapsed(input.elapsedMs)}`;

interface GuildSummaryInput {
  readonly guildId: string;
  readonly cleanup: CleanupCounts;
  readonly channelsProcessed: number;
  readonly channelsTotal: number;
  readonly channelsAborted: number;
  readonly channelsNoPermission: number;
  readonly channelsNotFound: number;
  readonly channelsGuildNotAccessible: number;
  readonly channelsCursorPersistFailed: number;
  readonly channelsThreadEnumFailed: number;
  readonly totalProcessed: number;
  readonly totalUpserted: number;
  readonly totalBotDeleted: number;
  readonly totalSkippedNullAuthor: number;
  readonly totalSkippedAttachments: number;
  readonly totalSkippedReactions: number;
  readonly totalSkippedStickers: number;
  readonly elapsedMs: number;
  readonly anomalies: readonly AnomalyEntry[];
}

const COL = 30; // right-edge column for the summary numbers

const summaryLine = (label: string, value: string): string => {
  const padded = label.padEnd(COL);
  return `    ${padded}${value}`;
};

/**
 * One entry in the per-guild Anomaly list. Channels with a non-`ok`
 * final status are always listed; channels that finished `ok` but
 * triggered the retry path are listed as `retried-but-ok`.
 */
interface AnomalyEntry {
  readonly status:
    | 'aborted'
    | 'no-permission'
    | 'channel-not-found'
    | 'guild-not-accessible'
    | 'cursor-persist-failed'
    | 'thread-enum-failed'
    | 'retried-but-ok'
    | 'field-skip-ok';
  readonly channelName: string;
  readonly channelId: string;
  readonly reason: string;
  readonly partialUpserted?: number;
  readonly note?: string;
}

const cleanupRenderedLine = (
  counts: CleanupCounts,
  key: keyof CleanupCounts,
  label: string,
  value: number,
): string => {
  const reason = counts.errors[key as string];
  if (reason !== undefined) {
    return summaryLine(label, `ERROR (${reason})`);
  }
  return summaryLine(label, `${formatNumber(value)} deleted`);
};

const formatAnomalyBlock = (anomalies: readonly AnomalyEntry[]): readonly string[] => {
  if (anomalies.length === 0) {
    return ['  Anomaly list:', '    (none)', ''];
  }
  const out: string[] = ['  Anomaly list:'];
  for (const a of anomalies) {
    out.push(`    [${a.status}] ${a.channelName} (${a.channelId})`);
    out.push(`                 reason: ${a.reason}`);
    if (a.partialUpserted !== undefined) {
      out.push(
        `                 partial-progress: ${formatNumber(a.partialUpserted)} upserted before abort`,
      );
    }
    if (a.note !== undefined) {
      out.push(`                 note: ${a.note}`);
    }
  }
  out.push('');
  return out;
};

export const formatGuildSummary = (input: GuildSummaryInput): string => {
  const c = input.cleanup;
  const lines: string[] = [
    MAIN_SEPARATOR,
    ` Guild ${input.guildId} summary`,
    MAIN_SEPARATOR,
    '  Cleanup:',
    cleanupRenderedLine(c, 'messageIdNullOrEmpty', 'messageId null/empty:', c.messageIdNullOrEmpty),
    cleanupRenderedLine(c, 'messageIdDuplicate', 'messageId duplicates:', c.messageIdDuplicate),
    cleanupRenderedLine(c, 'channelIdMissing', 'channelId null/empty:', c.channelIdMissing),
    cleanupRenderedLine(c, 'userIdMissing', 'userId null/empty:', c.userIdMissing),
    cleanupRenderedLine(c, 'userNameMissing', 'userName null/empty:', c.userNameMissing),
    cleanupRenderedLine(c, 'timestampInvalid', 'timestamp invalid:', c.timestampInvalid),
    summaryLine('Total purged:', formatNumber(cleanupTotal(c))),
    summaryLine('Messages in DB (after):', formatNumber(c.totalCount)),
    '  Backfill:',
    summaryLine(
      'Channels processed:',
      `${formatNumber(input.channelsProcessed)} / ${formatNumber(input.channelsTotal)}`,
    ),
    summaryLine('Channels aborted:', formatNumber(input.channelsAborted)),
    summaryLine('Channels no-permission:', formatNumber(input.channelsNoPermission)),
    summaryLine('Channels not-found:', formatNumber(input.channelsNotFound)),
    summaryLine('Channels guild-not-accessible:', formatNumber(input.channelsGuildNotAccessible)),
    summaryLine('Channels cursor-persist-failed:', formatNumber(input.channelsCursorPersistFailed)),
    summaryLine('Channels thread-enum-failed:', formatNumber(input.channelsThreadEnumFailed)),
    summaryLine('Total messages processed:', formatNumber(input.totalProcessed)),
    summaryLine('Total upserted:', formatNumber(input.totalUpserted)),
    summaryLine('Total bot-deleted:', formatNumber(input.totalBotDeleted)),
    summaryLine('Total skipped (null author):', formatNumber(input.totalSkippedNullAuthor)),
    summaryLine('Total skipped (attachments):', formatNumber(input.totalSkippedAttachments)),
    summaryLine('Total skipped (reactions):', formatNumber(input.totalSkippedReactions)),
    summaryLine('Total skipped (stickers):', formatNumber(input.totalSkippedStickers)),
    `  Guild elapsed: ${formatElapsed(input.elapsedMs)}`,
    '',
    ...formatAnomalyBlock(input.anomalies),
  ];
  return lines.join('\n');
};

export interface PerChannelBreakdownRow {
  readonly name: string;
  readonly upserted: number;
  readonly botDeleted: number;
  readonly elapsedMs: number;
}

interface OverallSummaryInput {
  readonly guildsTotal: number;
  readonly guildsSucceeded: number;
  readonly guildsFailed: number;
  readonly cleanupTotal: number;
  readonly upsertedTotal: number;
  readonly botDeletedTotal: number;
  readonly skippedNullAuthorTotal: number;
  readonly skippedAttachmentsTotal: number;
  readonly skippedReactionsTotal: number;
  readonly skippedStickersTotal: number;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly elapsedMs: number;
  readonly breakdown: readonly PerChannelBreakdownRow[];
}

export const formatOverallSummary = (input: OverallSummaryInput): string => {
  const sorted = [...input.breakdown].sort((a, b) => b.upserted - a.upserted);
  const lines: string[] = [
    MAIN_SEPARATOR,
    ' OVERALL SUMMARY',
    MAIN_SEPARATOR,
    `  Guilds processed: ${String(input.guildsTotal)} / ${String(input.guildsTotal)} ` +
      `(${String(input.guildsSucceeded)} success, ${String(input.guildsFailed)} failed)`,
    `  Cleanup total: ${formatNumber(input.cleanupTotal)} invalid docs purged`,
    `  Backfill total: ${formatNumber(input.upsertedTotal)} upserted, ` +
      `${formatNumber(input.botDeletedTotal)} bot-deleted, ` +
      `${formatNumber(input.skippedNullAuthorTotal)} skipped (null author)`,
    `  Field-skip total (DB values preserved): ` +
      `${formatNumber(input.skippedAttachmentsTotal)} attachments, ` +
      `${formatNumber(input.skippedReactionsTotal)} reactions, ` +
      `${formatNumber(input.skippedStickersTotal)} stickers`,
    `  Started:  ${formatFullLocal(input.startedAt)}`,
    `  Finished: ${formatFullLocal(input.finishedAt)}`,
    `  Elapsed:  ${formatElapsed(input.elapsedMs)}`,
    '',
    '  Per-channel breakdown (sorted by upserted desc):',
  ];
  sorted.forEach((row, i) => {
    const idx = `${String(i + 1)}.`.padEnd(4);
    const namePart = row.name.padEnd(20);
    lines.push(
      `    ${idx}${namePart}` +
        `upserted ${padNumber(row.upserted, 8)}  ` +
        `bot-deleted ${padNumber(row.botDeleted, 6)}  ` +
        `elapsed ${formatElapsed(row.elapsedMs)}`,
    );
  });
  lines.push('');
  return lines.join('\n');
};

export const formatEndOfRun = (
  status: 'COMPLETED' | 'FAILED',
  reason?: string,
  lastProcessed?: string,
): string => {
  const headline =
    status === 'COMPLETED'
      ? ' End of run (status: COMPLETED)'
      : ` End of run (status: FAILED${reason !== undefined ? ` — ${reason}` : ''})`;
  const lines: string[] = [MAIN_SEPARATOR, headline];
  if (status === 'FAILED' && lastProcessed !== undefined) {
    lines.push(` Last processed: ${lastProcessed}`);
  }
  lines.push(MAIN_SEPARATOR, '');
  return lines.join('\n');
};

/**
 * Handle on the single per-run log file. Construct one at process
 * start and pass it through the call tree.
 *
 * Failure handling: the first `writeSync` failure flips the
 * handle into a broken state. From then on, `append` mirrors output
 * to `console.error` instead of trying the file again. `wasBroken()`
 * lets `main()` print a final stderr warning so the operator knows
 * to inspect the partial log.
 */
export interface RunLogFile {
  readonly filePath: string;
  /** Append the text exactly as given. Multi-line strings are fine. */
  append(text: string): void;
  /** Returns true once any write or close has failed. */
  wasBroken(): boolean;
  close(): void;
}

export const createRunLogFile = (rootDir: string, now: Date = new Date()): RunLogFile => {
  mkdirSync(rootDir, { recursive: true });
  const filePath = join(rootDir, `msg_backup_${filenameStamp(now)}.log`);
  // Open exclusively in append mode. Keeping the fd open avoids
  // reopening on every line and lets `close` flush deterministically.
  const fd = openSync(filePath, 'a');
  let broken = false;
  const reportFailure = (op: string, err: unknown): void => {
    if (!broken) {
      broken = true;
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[msg_backup] run-log ${op} failed (${reason}); subsequent log lines mirrored to stderr only.`,
      );
    }
  };
  return {
    filePath,
    append(text: string): void {
      if (text.length === 0) return;
      if (broken) {
        // Once the file is unusable, keep the operator informed via
        // stderr so the per-run record is at least observable live.
        process.stderr.write(text);
        return;
      }
      try {
        writeSync(fd, text);
      } catch (err: unknown) {
        reportFailure('write', err);
        process.stderr.write(text);
      }
    },
    wasBroken(): boolean {
      return broken;
    },
    close(): void {
      try {
        closeSync(fd);
      } catch (err: unknown) {
        reportFailure('close', err);
      }
    },
  };
};

/**
 * Shorthand helper used by callers that already have the line ready
 * but don't want to format it via one of the structured helpers (e.g.
 * one-off `[Discord] Logging in...` lines).
 */
export const appendLine = (run: RunLogFile, line: string): void => {
  run.append(`${line}\n`);
};

/** Equivalent of `appendLine` but with a leading local-time prefix. */
export const appendStamped = (run: RunLogFile, line: string): void => {
  run.append(`${formatTimestamp()} ${line}\n`);
};
