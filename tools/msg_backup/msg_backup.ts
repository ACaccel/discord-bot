/**
 * Ops tool — full-history Discord message backup for one or more
 * guilds. Re-ingests every accessible channel from `start_date`
 * forward (or from the channel's earliest message when
 * `start_date` is empty).
 *
 * Configuration
 * -------------
 * All inputs come from `tools/msg_backup/config.json` (gitignored —
 * never commit operator credentials). No CLI args. The config schema
 * is documented in the sibling `config.example.json` and validated
 * at startup; a missing or malformed field fail-fasts with a
 * structured `ConfigurationError`.
 *
 * Behaviour summary
 * -----------------
 *   - Per-guild error isolation: a failure on one guild logs but
 *     does NOT abort subsequent guilds. The final overview reports
 *     the success/failure status of every guild.
 *   - Before channel discovery, each guild's `messages` collection
 *     is cleaned up — every doc failing any of the seven validity
 *     checks (mirrors `verify_db`) is deleted. Each
 *     check runs in its own try/catch so a single failed check does
 *     not abort the others (R-03).
 *   - Each guild's Mongo connection is opened with the project's
 *     `MongoConnectionManager`, so the production retry / disable
 *     behaviour applies.
 *   - **Backfill is UNCONDITIONAL UPSERT**: every Discord message
 *     becomes one `bulkWrite` `updateOne({messageId},{$set:doc},
 *     {upsert:true})`. DB is left aligned to Discord truth — reaction
 *     counts, content edits, attachment metadata refresh on every run.
 *     The pre-check / dup-detect path from the old skip-if-exists
 *     design is gone (R-23, R-25).
 *   - Channels are enumerated as `(text-like guild channels) ∪
 *     (active threads) ∪ (archived threads)`, paginated until the
 *     thread manager returns fewer than the page limit (R-08).
 *   - Transient Discord errors on `messages.fetch` retry with an
 *     exponential backoff (1s, 2s, 4s). Hard non-transient codes
 *     (50001/50013/10003/10004) bypass retries entirely and surface
 *     as the dedicated `no-permission` / `channel-not-found` status
 *     (R-04, R-11).
 *   - Empty channels still get a `Fetch` cursor row (`lastMessageID:
 *     ''`) so msg-archive's incremental path has something to read
 *     against (R-22).
 *
 * Logging
 * -------
 * Two parallel sinks:
 *   - **stdout** via pino-pretty (`createBootstrapLogger`) for the
 *     operator watching the run interactively.
 *   - **`tools/msg_backup/logs/msg_backup_<YYYY-MM-DD_HH-MM-SS>.log`**
 *     — a pure-text, single-file-per-run log produced by
 *     `text-logger.ts`. Filename is pinned at process start. Each
 *     write is wrapped in try/catch and falls back to stderr on
 *     failure (R-09).
 *
 * Time handling
 * -------------
 * All date/time math uses the operator's **local timezone** so that
 * `start_date: "2024-01-01"` in `config.json` means the local
 * midnight the operator typed. The run-log header records the
 * timezone offset so monthly buckets across multiple runs are
 * comparable only when the server timezone is consistent (R-15).
 */
import { resolve } from 'node:path';

import {
  ChannelType,
  Client,
  type Collection,
  DiscordAPIError,
  GatewayIntentBits,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  type AnyThreadChannel,
} from 'discord.js';

import { createBootstrapLogger } from '../../src/core/config';
import type { Logger } from '../../src/core/logger';
import {
  MongoConnectionManager,
  type GuildConnection,
} from '../../src/infra/mongo/connection-manager';
import { asGuildId } from '../../src/core/ids';
import {
  type ChannelOutcomeStatus as InternalChannelOutcomeStatus,
  buildAnomalies,
  buildBackfillDoc,
  monthKey,
  parseConfig,
  parseLocalMidnight,
  type ToolConfig,
  withRetry,
} from './internal';
import {
  appendLine,
  appendStamped,
  cleanupTotal,
  createRunLogFile,
  formatChannelDiscovery,
  formatChannelHeader,
  formatChannelSummary,
  formatCleanupSummary,
  formatConfigHeader,
  formatEndOfRun,
  formatGuildBanner,
  formatGuildSummary,
  formatMonthLine,
  formatOverallSummary,
  formatServerTimezone,
  formatTimestamp,
  type CleanupCounts,
  type DiscoveredChannelInfo,
  type PerChannelBreakdownRow,
  type RunLogFile,
} from './text-logger';

const CONFIG_PATH = resolve(__dirname, 'config.json');
const LOG_ROOT_DIR = resolve(__dirname, 'logs');

/** 60-second cap on `guild.channels.fetch()` (R-07). */
const GUILD_CHANNELS_FETCH_TIMEOUT_MS = 60_000;
/** Thread-manager page size — discord.js default. */
const THREAD_PAGE_LIMIT = 50;

interface ChannelStats {
  upserted: number;
  deletedBot: number;
  skippedNullAuthor: number;
  /**
   * Per-message counts of messages where we OMITTED the corresponding
   * nested array from the `$set` payload because Discord returned a
   * `null` in a critical field. Omitting preserves the DB-side value
   * rather than overwriting good data with a fallback empty value.
   */
  skippedAttachments: number;
  skippedReactions: number;
  skippedStickers: number;
  processed: number;
}

/**
 * Channel-level final outcome. `'ok'` and `'retried-but-ok'` are both
 * successes — the latter just means at least one transient retry fired
 * during the channel walk, so the operator gets to monitor the Discord
 * link quality. The set lives in `./internal` so the anomaly synth
 * helper can re-use it without circular imports.
 */
type ChannelOutcomeStatus = InternalChannelOutcomeStatus;

interface ChannelOutcome {
  readonly channelId: string;
  readonly channelName: string;
  readonly status: ChannelOutcomeStatus;
  readonly reason?: string;
  readonly stats: ChannelStats;
  readonly elapsedMs: number;
  readonly retriesObserved: number;
}

interface GuildOutcome {
  readonly guildId: string;
  readonly guildName: string;
  readonly status: 'ok' | 'failed';
  readonly error?: string;
  readonly cleanup: CleanupCounts;
  readonly channelOutcomes: readonly ChannelOutcome[];
  readonly elapsedMs: number;
}

// ---------- Cleanup (per-guild, runs BEFORE channel discovery) ----------

const CLEANUP_CHECK_KEYS = [
  'messageIdNullOrEmpty',
  'messageIdDuplicate',
  'channelIdMissing',
  'userIdMissing',
  'userNameMissing',
  'timestampInvalid',
  'totalCount',
] as const;
type CleanupCheckKey = (typeof CLEANUP_CHECK_KEYS)[number];

/**
 * Run a single cleanup check, isolating its failure from the rest
 * (R-03). Failures get logged to the run log and stored in
 * `errors[key]` so the summary line renders as `ERROR (<reason>)`.
 */
const runCleanupCheck = async (
  key: CleanupCheckKey,
  label: string,
  runLog: RunLogFile,
  guildLogger: Logger,
  fn: () => Promise<number>,
): Promise<{ readonly value: number; readonly error?: string }> => {
  const startedAt = Date.now();
  appendStamped(runLog, `[Cleanup] Checking ${label}...`);
  guildLogger.info({ check: key }, `msg_backup: cleanup checking ${label}`);
  try {
    const value = await fn();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    appendStamped(
      runLog,
      `[Cleanup] ${label}: ${key === 'totalCount' ? `count ${value.toLocaleString('en-US')}` : `deleted ${value.toLocaleString('en-US')}`} (elapsed ${elapsed}s)`,
    );
    return { value };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    appendStamped(runLog, `[Cleanup] ${label}: ERROR (${reason}) (elapsed ${elapsed}s)`);
    guildLogger.error(
      {
        check: key,
        err:
          err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) },
      },
      `msg_backup: cleanup check ${label} failed`,
    );
    return { value: 0, error: reason };
  }
};

/**
 * Delete every doc failing any of the seven validity checks. Each
 * check is isolated — a single failing query does not abort the
 * others (R-03). Returns the per-category counts and the per-check
 * error map for the summary renderer.
 */
const runCleanup = async (
  connection: GuildConnection,
  runLog: RunLogFile,
  guildLogger: Logger,
): Promise<CleanupCounts> => {
  const Message = connection.models.Message;
  const errors: Record<string, string> = {};
  const captured: Record<CleanupCheckKey, number> = {
    messageIdNullOrEmpty: 0,
    messageIdDuplicate: 0,
    channelIdMissing: 0,
    userIdMissing: 0,
    userNameMissing: 0,
    timestampInvalid: 0,
    totalCount: 0,
  };

  const record = async (
    key: CleanupCheckKey,
    label: string,
    fn: () => Promise<number>,
  ): Promise<void> => {
    const res = await runCleanupCheck(key, label, runLog, guildLogger, fn);
    captured[key] = res.value;
    if (res.error !== undefined) errors[key] = res.error;
  };

  await record(
    'messageIdNullOrEmpty',
    'messageId null/empty',
    async () =>
      (await Message.deleteMany({ $or: [{ messageId: null }, { messageId: '' }] }).exec())
        .deletedCount ?? 0,
  );

  await record(
    'channelIdMissing',
    'channelId null/empty',
    async () =>
      (await Message.deleteMany({ $or: [{ channelId: null }, { channelId: '' }] }).exec())
        .deletedCount ?? 0,
  );

  await record(
    'userIdMissing',
    'userId null/empty',
    async () =>
      (await Message.deleteMany({ $or: [{ userId: null }, { userId: '' }] }).exec()).deletedCount ??
      0,
  );

  await record(
    'userNameMissing',
    'userName null/empty',
    async () =>
      (await Message.deleteMany({ $or: [{ userName: null }, { userName: '' }] }).exec())
        .deletedCount ?? 0,
  );

  await record(
    'timestampInvalid',
    'timestamp invalid',
    async () =>
      (
        await Message.deleteMany({
          $or: [{ timestamp: { $not: { $type: 'number' } } }, { timestamp: { $lte: 0 } }],
        }).exec()
      ).deletedCount ?? 0,
  );

  await record('messageIdDuplicate', 'messageId duplicates', async () => {
    type DupGroup = {
      readonly _id: string;
      readonly count: number;
      readonly ids: readonly import('mongoose').Types.ObjectId[];
    };
    const dupGroups = (await Message.aggregate([
      { $match: { messageId: { $ne: null } } },
      { $group: { _id: '$messageId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
    ]).exec()) as DupGroup[];
    const victims: import('mongoose').Types.ObjectId[] = [];
    for (const g of dupGroups) {
      for (let i = 1; i < g.ids.length; i++) {
        const id = g.ids[i];
        if (id !== undefined) victims.push(id);
      }
    }
    if (victims.length === 0) return 0;
    return (await Message.deleteMany({ _id: { $in: victims } }).exec()).deletedCount ?? 0;
  });

  await record('totalCount', 'total count', async () => Message.countDocuments({}).exec());

  return {
    messageIdNullOrEmpty: captured.messageIdNullOrEmpty,
    messageIdDuplicate: captured.messageIdDuplicate,
    channelIdMissing: captured.channelIdMissing,
    userIdMissing: captured.userIdMissing,
    userNameMissing: captured.userNameMissing,
    timestampInvalid: captured.timestampInvalid,
    totalCount: captured.totalCount,
    errors,
  };
};

/** True iff every cleanup check failed — the only condition under which
 * the guild itself is marked failed by cleanup (R-03). */
const allCleanupChecksErrored = (counts: CleanupCounts): boolean =>
  CLEANUP_CHECK_KEYS.every((k) => counts.errors[k] !== undefined);

// ---------- Channel discovery ----------

const TEXT_LIKE_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
]);

const THREAD_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);

type FetchableChannel = GuildTextBasedChannel;

const isFetchable = (channel: unknown): channel is FetchableChannel => {
  if (typeof channel !== 'object' || channel === null) return false;
  const c = channel as { readonly messages?: { readonly fetch?: unknown } };
  return typeof c.messages?.fetch === 'function';
};

const channelTypeLabel = (type: ChannelType): string => ChannelType[type] ?? `Type${String(type)}`;

interface ThreadEnumFailure {
  readonly channelId: string;
  readonly channelName: string;
  readonly reason: string;
}

interface DiscoveryBuckets {
  readonly all: readonly FetchableChannel[];
  readonly parents: readonly DiscoveredChannelInfo[];
  readonly activeThreads: readonly DiscoveredChannelInfo[];
  readonly archivedThreads: readonly DiscoveredChannelInfo[];
  /**
   * Parent channels whose thread enumeration (`fetchActive` /
   * `fetchArchived`) failed. Silent data loss — the threads under
   * each entry were not discovered and so will not be backfilled.
   * reconcileGuild surfaces these as `thread-enum-failed` channel
   * outcomes so the operator sees them in the anomaly list and the
   * process exits non-zero.
   */
  readonly threadEnumFailures: readonly ThreadEnumFailure[];
}

const channelName = (channel: FetchableChannel): string => {
  const named = channel as { readonly name?: unknown };
  return typeof named.name === 'string' ? named.name : channel.id;
};

const parentNameOf = (thread: AnyThreadChannel): string | undefined => {
  const parent = thread.parent;
  if (parent === null) return undefined;
  const named = parent as { readonly name?: unknown };
  return typeof named.name === 'string' ? named.name : undefined;
};

/**
 * Discord's `ThreadManager.fetchActive` / `fetchArchived` return at
 * most one page (≤ 50 by default). For long-lived forum / news
 * channels the archived list almost always exceeds that — we must
 * paginate until a page returns fewer than the limit (R-08). The
 * cursor is the oldest archived thread's `archivedTimestamp` (or, for
 * active threads, `joinedTimestamp` — but active threads are usually a
 * short list so a single page is normally enough; we still loop for
 * safety).
 */
type ThreadFetchResult = { readonly threads: Collection<string, AnyThreadChannel> };
type ThreadFetcher = (options?: {
  readonly before?: Date | number | string;
  readonly limit?: number;
}) => Promise<ThreadFetchResult>;

const paginateThreads = async (
  fetcher: ThreadFetcher,
  label: string,
  runLog: RunLogFile,
  pageLimit: number = THREAD_PAGE_LIMIT,
): Promise<readonly AnyThreadChannel[]> => {
  const out: AnyThreadChannel[] = [];
  const seen = new Set<string>();
  let beforeCursor: Date | number | string | undefined;
  let batchIndex = 0;
  while (true) {
    batchIndex += 1;
    const page: ThreadFetchResult = await fetcher(
      beforeCursor !== undefined
        ? { before: beforeCursor, limit: pageLimit }
        : { limit: pageLimit },
    );
    const pageSize = page.threads.size;
    appendStamped(
      runLog,
      `[Channel discovery] ${label}: batch ${String(batchIndex)} (${String(pageSize)})`,
    );
    if (pageSize === 0) break;
    let oldestTs: number | undefined;
    let oldestId: string | undefined;
    for (const thread of page.threads.values()) {
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      out.push(thread);
      const ts = thread.archiveTimestamp ?? thread.createdTimestamp ?? undefined;
      if (ts !== null && ts !== undefined && (oldestTs === undefined || ts < oldestTs)) {
        oldestTs = ts;
        oldestId = thread.id;
      }
    }
    if (pageSize < pageLimit) break;
    if (oldestTs === undefined) {
      // No cursor we can advance on — break to avoid an infinite loop.
      // This can only happen if the API returns a full page of threads
      // none of which carry an `archivedTimestamp`.
      break;
    }
    // Track the actual id for diagnostics; the discord.js cursor only
    // needs the timestamp, but logging the id helps reproduce edge
    // cases offline.
    void oldestId;
    beforeCursor = oldestTs;
  }
  appendStamped(
    runLog,
    `[Channel discovery] ${label}: done (${String(out.length)} total across ${String(batchIndex)} batches)`,
  );
  return out;
};

/**
 * Wrap a promise in a hard timeout (R-07). Resolves with the original
 * value on success, rejects with an `Error('<context> timed out after
 * <ms>ms')` if the deadline passes first. The underlying promise
 * keeps running — we do not have a way to abort discord.js's manager
 * fetch — but the call site moves on.
 */
const withTimeout = async <T>(promise: Promise<T>, ms: number, context: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${context} timed out after ${String(ms)}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * Enumerate every channel/thread under `guild` that supports
 * `messages.fetch`. Threads come from both the active list and the
 * paginated archived list (including forum posts) so a long-running
 * channel does not silently lose its archived history.
 */
const collectChannels = async (
  client: Client,
  guildId: string,
  logger: Logger,
  runLog: RunLogFile,
): Promise<DiscoveryBuckets> => {
  const guild = await client.guilds.fetch(guildId);
  await withTimeout(
    guild.channels.fetch(),
    GUILD_CHANNELS_FETCH_TIMEOUT_MS,
    `guild.channels.fetch(${guildId})`,
  );

  const seen = new Set<string>();
  const all: FetchableChannel[] = [];
  const parents: DiscoveredChannelInfo[] = [];
  const activeThreads: DiscoveredChannelInfo[] = [];
  const archivedThreads: DiscoveredChannelInfo[] = [];
  const threadEnumFailures: ThreadEnumFailure[] = [];
  let nextIndex = 1;

  for (const channel of guild.channels.cache.values()) {
    if (channel === null) continue;
    if (TEXT_LIKE_CHANNEL_TYPES.has(channel.type) && isFetchable(channel)) {
      if (!seen.has(channel.id)) {
        seen.add(channel.id);
        all.push(channel);
        parents.push({
          index: nextIndex++,
          name: channelName(channel),
          id: channel.id,
          type: channelTypeLabel(channel.type),
        });
      }
    }

    const maybeThreaded = channel as {
      readonly threads?: {
        readonly fetchActive?: ThreadFetcher;
        readonly fetchArchived?: ThreadFetcher;
      };
    };
    if (
      maybeThreaded.threads !== undefined &&
      typeof maybeThreaded.threads.fetchActive === 'function' &&
      typeof maybeThreaded.threads.fetchArchived === 'function'
    ) {
      try {
        const activeList = await paginateThreads(
          maybeThreaded.threads.fetchActive.bind(maybeThreaded.threads),
          `Active threads in #${channelName(channel as FetchableChannel)}`,
          runLog,
        );
        const archivedList = await paginateThreads(
          maybeThreaded.threads.fetchArchived.bind(maybeThreaded.threads),
          `Archived threads in #${channelName(channel as FetchableChannel)}`,
          runLog,
        );
        const pushThread = (thread: AnyThreadChannel, bucket: DiscoveredChannelInfo[]): void => {
          if (!THREAD_CHANNEL_TYPES.has(thread.type)) return;
          if (seen.has(thread.id)) return;
          if (!isFetchable(thread)) return;
          seen.add(thread.id);
          all.push(thread);
          bucket.push({
            index: nextIndex++,
            name: channelName(thread),
            id: thread.id,
            type: channelTypeLabel(thread.type),
            ...(parentNameOf(thread) !== undefined ? { parentName: parentNameOf(thread) } : {}),
          });
        };
        for (const thread of activeList) pushThread(thread, activeThreads);
        for (const thread of archivedList) pushThread(thread, archivedThreads);
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        const name = channelName(channel as FetchableChannel);
        threadEnumFailures.push({ channelId: channel.id, channelName: name, reason });
        logger.warn(
          {
            guildId,
            channelId: channel.id,
            err:
              err instanceof Error
                ? { message: err.message, name: err.name }
                : { value: String(err) },
          },
          'msg_backup: failed to enumerate threads for channel; surfacing as thread-enum-failed',
        );
        appendStamped(
          runLog,
          `WARNING: thread enumeration failed for #${name} (${channel.id}): ${reason}`,
        );
      }
    }
  }
  return { all, parents, activeThreads, archivedThreads, threadEnumFailures };
};

// ---------- Per-channel reconciliation ----------
//
// `withRetry` and the transient-error classifier (`isTransientError`)
// live in `./internal.ts` — pure, side-effect-free helpers that the
// unit tests cover directly. The orchestrator below imports them.

interface ReconcileResult {
  readonly stats: ChannelStats;
  readonly latestMessageId: string | undefined;
  readonly retriesObserved: number;
  readonly cursorPersistError?: string;
}

/**
 * Walk a single channel newest-to-oldest, batching every
 * `batchSize` messages into one Mongo `bulkWrite`. Returns the
 * running stats, the latest message id (used to advance
 * `Fetch.lastMessageID`), and the number of transient retries that
 * fired during the walk (powers the `retried-but-ok` anomaly).
 */
const reconcileChannel = async (
  channel: FetchableChannel,
  connection: GuildConnection,
  config: ToolConfig,
  guildLogger: Logger,
  runLog: RunLogFile,
): Promise<ReconcileResult> => {
  const lowerBoundMs =
    config.startDate !== undefined ? parseLocalMidnight(config.startDate) : undefined;
  const chLogger = guildLogger.child({ channelId: channel.id, channelName: channelName(channel) });
  let retriesObserved = 0;

  chLogger.info({}, 'msg_backup: channel start');
  if (lowerBoundMs === undefined) {
    appendStamped(runLog, 'Starting backfill, no lower time bound');
  } else {
    appendStamped(runLog, `Starting backfill, lower bound ${config.startDate ?? ''}`);
  }

  const stats: ChannelStats = {
    upserted: 0,
    deletedBot: 0,
    skippedNullAuthor: 0,
    skippedAttachments: 0,
    skippedReactions: 0,
    skippedStickers: 0,
    processed: 0,
  };

  /**
   * Month bucket — flushed when the next month is observed or the
   * channel finishes. Tracks per-month deltas, not running totals.
   */
  let monthAcc:
    | {
        month: string;
        processed: number;
        upserted: number;
        botDeleted: number;
        skippedNullAuthor: number;
        skippedAttachments: number;
        skippedReactions: number;
        skippedStickers: number;
      }
    | undefined;
  const finalizeMonth = (): void => {
    if (monthAcc === undefined) return;
    const line = formatMonthLine({
      month: monthAcc.month,
      processed: monthAcc.processed,
      upserted: monthAcc.upserted,
      botDeleted: monthAcc.botDeleted,
      skippedNullAuthor: monthAcc.skippedNullAuthor,
      skippedAttachments: monthAcc.skippedAttachments,
      skippedReactions: monthAcc.skippedReactions,
      skippedStickers: monthAcc.skippedStickers,
    });
    runLog.append(`${line}\n`);
    monthAcc = undefined;
  };

  let latestMessageId: string | undefined;
  let beforeId: string | undefined;

  type Pending = {
    upserts: Record<string, unknown>[];
    botDeletes: string[];
  };
  const pending: Pending = { upserts: [], botDeletes: [] };

  const flush = async (): Promise<{ readonly upserted: number; readonly deletedBot: number }> => {
    const delta = { upserted: 0, deletedBot: 0 };
    if (pending.upserts.length > 0) {
      // Unconditional upsert: every fetched message overwrites its DB
      // row in full (R-23). bulkWrite returns `upsertedCount` (new
      // rows) and `modifiedCount` (existing rows changed). We report
      // the union — both count as "upserted from Discord truth".
      const ops = pending.upserts.map((doc) => ({
        updateOne: {
          filter: { messageId: doc['messageId'] as string },
          update: { $set: doc },
          upsert: true,
        },
      }));
      const res = await connection.models.Message.bulkWrite(ops, { ordered: false });
      const upsertedCount = res.upsertedCount ?? 0;
      const modifiedCount = res.modifiedCount ?? 0;
      delta.upserted = upsertedCount + modifiedCount;
      stats.upserted += delta.upserted;
      pending.upserts = [];
    }
    if (pending.botDeletes.length > 0) {
      const res = await connection.models.Message.deleteMany({
        messageId: { $in: pending.botDeletes },
      }).exec();
      const n = res.deletedCount ?? 0;
      delta.deletedBot = n;
      stats.deletedBot += n;
      pending.botDeletes = [];
    }
    return delta;
  };

  // Per-batch buffers. `batch` holds raw Discord messages until it
  // reaches `batchSize`; `batchMonths` is the parallel month-key
  // attribution so we can compute per-month deltas accurately after
  // each flush.
  const batch: Message[] = [];
  const batchMonths: string[] = [];

  const processBatch = async (): Promise<void> => {
    if (batch.length === 0) return;

    type Bucket = {
      processed: number;
      upserts: number;
      botDeletes: number;
      skippedNullAuthor: number;
      skippedAttachments: number;
      skippedReactions: number;
      skippedStickers: number;
    };
    const monthBuckets = new Map<string, Bucket>();
    const bucketFor = (mk: string): Bucket => {
      const existingBucket = monthBuckets.get(mk);
      if (existingBucket !== undefined) return existingBucket;
      const fresh: Bucket = {
        processed: 0,
        upserts: 0,
        botDeletes: 0,
        skippedNullAuthor: 0,
        skippedAttachments: 0,
        skippedReactions: 0,
        skippedStickers: 0,
      };
      monthBuckets.set(mk, fresh);
      return fresh;
    };

    batch.forEach((msg, idx) => {
      const mk = batchMonths[idx] ?? monthKey(msg.createdTimestamp);
      const b = bucketFor(mk);
      stats.processed += 1;
      b.processed += 1;
      // R-01: webhook deletion / cross-post source removal can leave
      // an authored-by-null row. Don't try to upsert it — count it as
      // skipped and let the operator see it in the per-channel /
      // per-month stats.
      if (msg.author === null) {
        stats.skippedNullAuthor += 1;
        b.skippedNullAuthor += 1;
        return;
      }
      if (msg.author.bot) {
        if (config.deleteBotMessages) {
          pending.botDeletes.push(msg.id);
          b.botDeletes += 1;
        }
        return;
      }
      const built = buildBackfillDoc(msg, channel);
      pending.upserts.push(built.doc);
      b.upserts += 1;
      if (built.skipped.attachments) {
        stats.skippedAttachments += 1;
        b.skippedAttachments += 1;
      }
      if (built.skipped.reactions) {
        stats.skippedReactions += 1;
        b.skippedReactions += 1;
      }
      if (built.skipped.stickers) {
        stats.skippedStickers += 1;
        b.skippedStickers += 1;
      }
    });

    const delta = await flush();
    batch.length = 0;
    batchMonths.length = 0;

    // Distribute the flush's actual deltas back to per-month
    // accumulators. Requested counts (e.g. 17 upsert ops queued) and
    // actual counts (e.g. bulkWrite reports 14 modified + 3 inserted
    // = 17) usually match exactly under the unconditional-upsert
    // contract, but treating them as a ratio keeps the math honest
    // when bulkWrite reports a discrepancy.
    const monthsInBatch = Array.from(monthBuckets.keys());
    const requestedUpserts = monthsInBatch.reduce(
      (a, m) => a + (monthBuckets.get(m)?.upserts ?? 0),
      0,
    );
    const requestedBotDeletes = monthsInBatch.reduce(
      (a, m) => a + (monthBuckets.get(m)?.botDeletes ?? 0),
      0,
    );
    const upsertScale = requestedUpserts === 0 ? 0 : delta.upserted / requestedUpserts;
    const botDeleteScale = requestedBotDeletes === 0 ? 0 : delta.deletedBot / requestedBotDeletes;

    // R-12: to guarantee that per-month sums equal channel totals
    // exactly, attribute every month except the last by rounding and
    // give the residual to the last month.
    let accUpserted = 0;
    let accBotDeleted = 0;
    monthsInBatch.forEach((mk, idx) => {
      const b = monthBuckets.get(mk);
      if (b === undefined) return;
      if (monthAcc === undefined) {
        monthAcc = {
          month: mk,
          processed: 0,
          upserted: 0,
          botDeleted: 0,
          skippedNullAuthor: 0,
          skippedAttachments: 0,
          skippedReactions: 0,
          skippedStickers: 0,
        };
      } else if (monthAcc.month !== mk) {
        finalizeMonth();
        monthAcc = {
          month: mk,
          processed: 0,
          upserted: 0,
          botDeleted: 0,
          skippedNullAuthor: 0,
          skippedAttachments: 0,
          skippedReactions: 0,
          skippedStickers: 0,
        };
      }
      let upsertedShare: number;
      let botDeletedShare: number;
      if (idx === monthsInBatch.length - 1) {
        upsertedShare = delta.upserted - accUpserted;
        botDeletedShare = delta.deletedBot - accBotDeleted;
      } else {
        upsertedShare = Math.round(b.upserts * upsertScale);
        botDeletedShare = Math.round(b.botDeletes * botDeleteScale);
        accUpserted += upsertedShare;
        accBotDeleted += botDeletedShare;
      }
      monthAcc.processed += b.processed;
      monthAcc.upserted += upsertedShare;
      monthAcc.botDeleted += botDeletedShare;
      monthAcc.skippedNullAuthor += b.skippedNullAuthor;
      monthAcc.skippedAttachments += b.skippedAttachments;
      monthAcc.skippedReactions += b.skippedReactions;
      monthAcc.skippedStickers += b.skippedStickers;
    });
  };

  outer: while (true) {
    const fetched: Collection<string, Message> = await withRetry(
      () =>
        channel.messages.fetch({
          limit: 100,
          ...(beforeId !== undefined ? { before: beforeId } : {}),
        }),
      `messages.fetch(${channel.id}${beforeId !== undefined ? `, before=${beforeId}` : ''})`,
      (line) => {
        retriesObserved += 1;
        appendStamped(runLog, line);
        chLogger.warn({ channelId: channel.id }, line);
      },
    );
    if (fetched.size === 0) break;

    for (const msg of fetched.values()) {
      if (latestMessageId === undefined) {
        latestMessageId = msg.id;
      }
      if (lowerBoundMs !== undefined && msg.createdTimestamp < lowerBoundMs) {
        await processBatch();
        break outer;
      }
      batch.push(msg);
      batchMonths.push(monthKey(msg.createdTimestamp));
      if (batch.length >= config.batchSize) {
        await processBatch();
      }
    }
    await processBatch();

    const lastKey = fetched.lastKey();
    if (lastKey === undefined) break;
    beforeId = lastKey;
  }

  finalizeMonth();

  // Persist the Fetch cursor for incremental future runs. R-22: even
  // for an empty channel we still write the row (with `''` as the
  // cursor) so msg-archive's per-hour incremental path has something
  // to read against. R-02: wrap in try/catch so a single Mongo write
  // failure does not falsely flag the channel as aborted.
  let cursorPersistError: string | undefined;
  try {
    const fetchValue = latestMessageId ?? '';
    const kept = await connection.models.Fetch.findOneAndUpdate(
      { channelID: channel.id },
      { $set: { channel: channelName(channel), lastMessageID: fetchValue } },
      { upsert: true, new: true },
    ).exec();
    if (kept !== null) {
      await connection.models.Fetch.deleteMany({
        channelID: channel.id,
        _id: { $ne: kept._id },
      }).exec();
    }
  } catch (err: unknown) {
    cursorPersistError = err instanceof Error ? err.message : String(err);
    chLogger.warn(
      {
        channelId: channel.id,
        err:
          err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) },
      },
      'msg_backup: Fetch cursor persist failed; channel data is fine, msg-archive will resume from old cursor',
    );
    appendStamped(
      runLog,
      `WARNING: Fetch cursor persist failed: ${cursorPersistError} (channel data is intact)`,
    );
  }

  chLogger.info(
    { ...stats, latestMessageId: latestMessageId ?? null, retriesObserved },
    'msg_backup: channel done',
  );
  return {
    stats,
    latestMessageId,
    retriesObserved,
    ...(cursorPersistError !== undefined ? { cursorPersistError } : {}),
  };
};

// ---------- Per-guild ----------

/** Map a thrown error from `channel.messages.fetch` to a channel status. */
const classifyChannelError = (
  err: unknown,
): {
  readonly status: Exclude<
    ChannelOutcomeStatus,
    'ok' | 'retried-but-ok' | 'cursor-persist-failed' | 'guild-not-accessible'
  >;
  readonly reason: string;
} => {
  if (err instanceof DiscordAPIError) {
    const code = typeof err.code === 'number' ? err.code : Number(err.code);
    if (code === 50001 || code === 50013) {
      return { status: 'no-permission', reason: `DiscordAPIError[${String(code)}] ${err.message}` };
    }
    if (code === 10003 || code === 10004) {
      return {
        status: 'channel-not-found',
        reason: `DiscordAPIError[${String(code)}] ${err.message}`,
      };
    }
  }
  const reason = err instanceof Error ? err.message : String(err);
  return { status: 'aborted', reason };
};

const reconcileGuild = async (
  client: Client,
  guildId: string,
  connection: GuildConnection,
  config: ToolConfig,
  guildLogger: Logger,
  runLog: RunLogFile,
): Promise<{
  readonly guildName: string;
  readonly cleanup: CleanupCounts;
  readonly channelOutcomes: readonly ChannelOutcome[];
}> => {
  // R-06: distinguish "bot not in this guild" from generic failures.
  let guild: Guild;
  try {
    guild = await client.guilds.fetch(guildId);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    runLog.append(formatGuildBanner(guildId, '(guild not accessible)'));
    appendStamped(
      runLog,
      `ERROR: guild not accessible — bot is not in this guild, or guild was deleted: ${reason}`,
    );
    const emptyCleanup: CleanupCounts = {
      messageIdNullOrEmpty: 0,
      messageIdDuplicate: 0,
      channelIdMissing: 0,
      userIdMissing: 0,
      userNameMissing: 0,
      timestampInvalid: 0,
      totalCount: 0,
      errors: {},
    };
    return {
      guildName: '(guild not accessible)',
      cleanup: emptyCleanup,
      channelOutcomes: [
        {
          channelId: '(n/a)',
          channelName: '(guild)',
          status: 'guild-not-accessible',
          reason,
          stats: {
            upserted: 0,
            deletedBot: 0,
            skippedNullAuthor: 0,
            skippedAttachments: 0,
            skippedReactions: 0,
            skippedStickers: 0,
            processed: 0,
          },
          elapsedMs: 0,
          retriesObserved: 0,
        },
      ],
    };
  }

  runLog.append(formatGuildBanner(guildId, guild.name));

  // Step 1: cleanup. Runs BEFORE channel discovery so the channel
  // backfill operates on a fresh, valid baseline. Per-check try/catch
  // is inside `runCleanup` (R-03); we only fail the guild if EVERY
  // check errored.
  guildLogger.info({}, 'msg_backup: cleanup starting');
  const cleanup = await runCleanup(connection, runLog, guildLogger);
  runLog.append(formatCleanupSummary(cleanup));
  if (allCleanupChecksErrored(cleanup)) {
    appendStamped(runLog, 'ERROR: every cleanup check failed; aborting this guild before backfill');
    guildLogger.error({ cleanup }, 'msg_backup: all cleanup checks failed');
    return { guildName: guild.name, cleanup, channelOutcomes: [] };
  }
  guildLogger.info({ cleanup, total: cleanupTotal(cleanup) }, 'msg_backup: cleanup complete');

  // Step 2: discover channels (with R-07 timeout on the underlying
  // channels.fetch and R-08 paginated thread discovery).
  let discovery: DiscoveryBucketsForGuild;
  try {
    discovery = await collectChannels(client, guildId, guildLogger, runLog);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    appendStamped(runLog, `ERROR: channel discovery failed: ${reason}`);
    guildLogger.error(
      {
        err:
          err instanceof Error
            ? { message: err.message, name: err.name, stack: err.stack }
            : { value: String(err) },
      },
      'msg_backup: channel discovery failed',
    );
    return {
      guildName: guild.name,
      cleanup,
      channelOutcomes: [
        {
          channelId: '(n/a)',
          channelName: '(channel discovery)',
          status: 'aborted',
          reason: `channel discovery failed: ${reason}`,
          stats: {
            upserted: 0,
            deletedBot: 0,
            skippedNullAuthor: 0,
            skippedAttachments: 0,
            skippedReactions: 0,
            skippedStickers: 0,
            processed: 0,
          },
          elapsedMs: 0,
          retriesObserved: 0,
        },
      ],
    };
  }
  runLog.append(
    formatChannelDiscovery({
      total: discovery.all.length,
      parents: discovery.parents,
      activeThreads: discovery.activeThreads,
      archivedThreads: discovery.archivedThreads,
    }),
  );
  guildLogger.info(
    { channelCount: discovery.all.length, guildName: guild.name },
    'msg_backup: enumerated channels',
  );

  // Step 3: reconcile per-channel.
  const channelOutcomes: ChannelOutcome[] = [];

  // Surface thread-enumeration failures from discovery as synthetic
  // channel outcomes — silent thread-data-loss must be visible in
  // both the anomaly list and the guild-level failure detection so
  // the process exits non-zero. Each failed parent contributes one
  // entry tagged `thread-enum-failed`; the parent itself may still
  // have been processed successfully via the normal channel loop.
  for (const f of discovery.threadEnumFailures) {
    channelOutcomes.push({
      channelId: f.channelId,
      channelName: f.channelName,
      status: 'thread-enum-failed',
      reason: f.reason,
      stats: {
        upserted: 0,
        deletedBot: 0,
        skippedNullAuthor: 0,
        skippedAttachments: 0,
        skippedReactions: 0,
        skippedStickers: 0,
        processed: 0,
      },
      elapsedMs: 0,
      retriesObserved: 0,
    });
  }

  const total = discovery.all.length;
  for (let i = 0; i < total; i++) {
    const channel = discovery.all[i];
    if (channel === undefined) continue;
    const name = channelName(channel);
    runLog.append(`\n${formatChannelHeader(i + 1, total, name, channel.id)}\n`);

    const startedAt = Date.now();
    try {
      const { stats, retriesObserved, cursorPersistError } = await reconcileChannel(
        channel,
        connection,
        config,
        guildLogger,
        runLog,
      );
      const elapsedMs = Date.now() - startedAt;
      runLog.append(
        `${formatChannelSummary({
          processed: stats.processed,
          upserted: stats.upserted,
          botDeleted: stats.deletedBot,
          skippedNullAuthor: stats.skippedNullAuthor,
          skippedAttachments: stats.skippedAttachments,
          skippedReactions: stats.skippedReactions,
          skippedStickers: stats.skippedStickers,
          elapsedMs,
        })}\n`,
      );
      // Final status decision (per Anomaly list contract):
      //   cursor-persist-failed > retried-but-ok > ok.
      let status: ChannelOutcomeStatus = 'ok';
      let reason: string | undefined;
      if (cursorPersistError !== undefined) {
        status = 'cursor-persist-failed';
        reason = cursorPersistError;
      } else if (retriesObserved > 0) {
        status = 'retried-but-ok';
        reason = `${String(retriesObserved)} retr${retriesObserved === 1 ? 'y' : 'ies'} during fetch, eventually succeeded`;
      }
      channelOutcomes.push({
        channelId: channel.id,
        channelName: name,
        status,
        ...(reason !== undefined ? { reason } : {}),
        stats,
        elapsedMs,
        retriesObserved,
      });
    } catch (err: unknown) {
      const elapsedMs = Date.now() - startedAt;
      const { status, reason } = classifyChannelError(err);
      runLog.append(`${formatTimestamp()} ERROR [${status}]: ${reason}\n`);
      // Capture the stack to the run log so a generic message like
      // `Cannot read properties of null (reading 'id')` can be
      // localised without a re-run. pino's stdout already carries the
      // stack on the structured `err` field, but operators typically
      // inspect the run log file post-mortem.
      if (err instanceof Error && err.stack !== undefined) {
        runLog.append(`${formatTimestamp()} Stack:\n${err.stack}\n`);
      }
      runLog.append(
        `${formatTimestamp()} Channel marked ${status} (will continue with next channel)\n`,
      );
      guildLogger.error(
        {
          channelId: channel.id,
          channelName: name,
          status,
          err:
            err instanceof Error
              ? { message: err.message, name: err.name, stack: err.stack }
              : { value: String(err) },
        },
        'msg_backup: channel reconcile failed; continuing with next channel',
      );
      channelOutcomes.push({
        channelId: channel.id,
        channelName: name,
        status,
        reason,
        stats: {
          upserted: 0,
          deletedBot: 0,
          skippedNullAuthor: 0,
          skippedAttachments: 0,
          skippedReactions: 0,
          skippedStickers: 0,
          processed: 0,
        },
        elapsedMs,
        retriesObserved: 0,
      });
    }
  }

  return { guildName: guild.name, cleanup, channelOutcomes };
};

type DiscoveryBucketsForGuild = DiscoveryBuckets;

// ---------- Main ----------

const buildLogger = (): Logger => {
  // Force-disable the env-driven file-router so the bootstrap factory
  // does not write under `process.env.LOG_DIR` — this tool routes its
  // human-facing output exclusively through the per-run text log
  // (`tools/msg_backup/logs/msg_backup_<...>.log`). pino retains the
  // pretty stdout stream that `createBootstrapLogger` provides.
  process.env['LOG_DIR'] = '';
  return createBootstrapLogger({ bot: 'msg_backup', component: 'msg_backup' });
};

const sumChannelStats = (outcomes: readonly ChannelOutcome[]): ChannelStats =>
  outcomes.reduce<ChannelStats>(
    (acc, o) => ({
      upserted: acc.upserted + o.stats.upserted,
      deletedBot: acc.deletedBot + o.stats.deletedBot,
      skippedNullAuthor: acc.skippedNullAuthor + o.stats.skippedNullAuthor,
      skippedAttachments: acc.skippedAttachments + o.stats.skippedAttachments,
      skippedReactions: acc.skippedReactions + o.stats.skippedReactions,
      skippedStickers: acc.skippedStickers + o.stats.skippedStickers,
      processed: acc.processed + o.stats.processed,
    }),
    {
      upserted: 0,
      deletedBot: 0,
      skippedNullAuthor: 0,
      skippedAttachments: 0,
      skippedReactions: 0,
      skippedStickers: 0,
      processed: 0,
    },
  );

const buildBreakdown = (outcomes: readonly GuildOutcome[]): readonly PerChannelBreakdownRow[] => {
  const rows: PerChannelBreakdownRow[] = [];
  for (const g of outcomes) {
    for (const c of g.channelOutcomes) {
      if (c.status !== 'ok' && c.status !== 'retried-but-ok') continue;
      rows.push({
        name: c.channelName,
        upserted: c.stats.upserted,
        botDeleted: c.stats.deletedBot,
        elapsedMs: c.elapsedMs,
      });
    }
  }
  return rows;
};

const main = async (): Promise<void> => {
  const startedAt = new Date();
  const logger = buildLogger();
  const config = parseConfig(CONFIG_PATH);

  const runLog = createRunLogFile(LOG_ROOT_DIR, startedAt);
  runLog.append(
    formatConfigHeader({
      startedAt,
      mongoUri: config.mongoUri,
      guilds: config.guilds,
      startDate: config.startDate,
      deleteBotMessages: config.deleteBotMessages,
      batchSize: config.batchSize,
    }),
  );

  logger.info(
    {
      guildCount: config.guilds.length,
      startDate: config.startDate ?? '(no lower bound — full backfill)',
      deleteBotMessages: config.deleteBotMessages,
      batchSize: config.batchSize,
      logFile: runLog.filePath,
      serverTimezone: formatServerTimezone(startedAt),
    },
    'msg_backup: starting',
  );

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const connectionManager = new MongoConnectionManager(config.mongoUri);
  const outcomes: GuildOutcome[] = [];

  try {
    appendLine(runLog, '[Discord] Logging in...');
    await client.login(config.discordToken);
    // R-10: discord.js's `login()` resolves once the gateway handshake
    // begins, not when the client is fully ready to serve fetches.
    // Wait for the explicit ready event so the first guild.fetch is
    // not racing the initial guild sync.
    if (!client.isReady()) {
      await new Promise<void>((resolveReady) => {
        client.once('ready', () => resolveReady());
      });
    }
    const userTag = client.user?.username ?? '<unknown>';
    appendLine(runLog, `[Discord] Logged in as ${userTag}`);
    logger.info({ userTag }, 'msg_backup: discord login complete');

    for (const guildId of config.guilds) {
      const guildLogger = logger.child({ guildId });
      const guildStartedAt = Date.now();
      try {
        const conn = await connectionManager.getConnection(asGuildId(guildId));
        const { guildName, cleanup, channelOutcomes } = await reconcileGuild(
          client,
          guildId,
          conn,
          config,
          guildLogger,
          runLog,
        );
        const totals = sumChannelStats(channelOutcomes);
        const elapsedMs = Date.now() - guildStartedAt;
        const aborted = channelOutcomes.filter((c) => c.status === 'aborted');
        const noPermission = channelOutcomes.filter((c) => c.status === 'no-permission');
        const notFound = channelOutcomes.filter((c) => c.status === 'channel-not-found');
        const guildNotAccessible = channelOutcomes.filter(
          (c) => c.status === 'guild-not-accessible',
        );
        const cursorFailed = channelOutcomes.filter((c) => c.status === 'cursor-persist-failed');
        const threadEnumFailed = channelOutcomes.filter((c) => c.status === 'thread-enum-failed');
        const ok = channelOutcomes.filter(
          (c) => c.status === 'ok' || c.status === 'retried-but-ok',
        );
        runLog.append(
          formatGuildSummary({
            guildId,
            cleanup,
            channelsProcessed: ok.length,
            channelsTotal: channelOutcomes.length,
            channelsAborted: aborted.length,
            channelsNoPermission: noPermission.length,
            channelsNotFound: notFound.length,
            channelsGuildNotAccessible: guildNotAccessible.length,
            channelsCursorPersistFailed: cursorFailed.length,
            channelsThreadEnumFailed: threadEnumFailed.length,
            totalProcessed: totals.processed,
            totalUpserted: totals.upserted,
            totalBotDeleted: totals.deletedBot,
            totalSkippedNullAuthor: totals.skippedNullAuthor,
            totalSkippedAttachments: totals.skippedAttachments,
            totalSkippedReactions: totals.skippedReactions,
            totalSkippedStickers: totals.skippedStickers,
            elapsedMs,
            anomalies: buildAnomalies(channelOutcomes),
          }),
        );
        // Guild-level failure detection. Trigger conditions:
        //   - synthetic `(n/a)` entry: R-06 (guild not accessible) or
        //     R-07/R-08 (channel discovery failed / timed out)
        //   - `'guild-not-accessible'` status (subset of the above)
        //   - `'thread-enum-failed'`: silent thread-data-loss; must
        //     never exit 0 because the operator would otherwise miss
        //     it (forum / discussion threads under that parent were
        //     not backfilled at all)
        //   - empty channel set: discovery returned nothing despite
        //     completing — surface so the operator investigates
        const guildLevelFault =
          channelOutcomes.some(
            (c) =>
              c.status === 'guild-not-accessible' ||
              c.status === 'thread-enum-failed' ||
              c.channelId === '(n/a)',
          ) || channelOutcomes.length === 0;
        outcomes.push({
          guildId,
          guildName,
          status: allCleanupChecksErrored(cleanup) || guildLevelFault ? 'failed' : 'ok',
          cleanup,
          channelOutcomes,
          elapsedMs,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const elapsedMs = Date.now() - guildStartedAt;
        guildLogger.error(
          {
            err:
              err instanceof Error
                ? { message: err.message, name: err.name, stack: err.stack }
                : { value: String(err) },
          },
          'msg_backup: guild reconcile failed; continuing with next guild',
        );
        const emptyCleanup: CleanupCounts = {
          messageIdNullOrEmpty: 0,
          messageIdDuplicate: 0,
          channelIdMissing: 0,
          userIdMissing: 0,
          userNameMissing: 0,
          timestampInvalid: 0,
          totalCount: 0,
          errors: {},
        };
        outcomes.push({
          guildId,
          guildName: '(unknown — connection or login failed)',
          status: 'failed',
          error: message,
          cleanup: emptyCleanup,
          channelOutcomes: [],
          elapsedMs,
        });
      }
    }
  } finally {
    try {
      await client.destroy();
    } catch (err: unknown) {
      logger.error(
        { err: err instanceof Error ? { message: err.message } : { value: String(err) } },
        'msg_backup: client.destroy() failed',
      );
    }
    try {
      await connectionManager.closeAll();
    } catch (err: unknown) {
      logger.error(
        { err: err instanceof Error ? { message: err.message } : { value: String(err) } },
        'msg_backup: connectionManager.closeAll() failed',
      );
    }
  }

  const finishedAt = new Date();
  const elapsedMs = finishedAt.getTime() - startedAt.getTime();
  const anyFailed = outcomes.some((o) => o.status === 'failed');
  const cleanupTotalAll = outcomes.reduce((a, o) => a + cleanupTotal(o.cleanup), 0);
  const upsertedTotal = outcomes.reduce(
    (a, o) => a + sumChannelStats(o.channelOutcomes).upserted,
    0,
  );
  const botDeletedTotal = outcomes.reduce(
    (a, o) => a + sumChannelStats(o.channelOutcomes).deletedBot,
    0,
  );
  const skippedNullAuthorTotal = outcomes.reduce(
    (a, o) => a + sumChannelStats(o.channelOutcomes).skippedNullAuthor,
    0,
  );
  const skippedAttachmentsTotal = outcomes.reduce(
    (a, o) => a + sumChannelStats(o.channelOutcomes).skippedAttachments,
    0,
  );
  const skippedReactionsTotal = outcomes.reduce(
    (a, o) => a + sumChannelStats(o.channelOutcomes).skippedReactions,
    0,
  );
  const skippedStickersTotal = outcomes.reduce(
    (a, o) => a + sumChannelStats(o.channelOutcomes).skippedStickers,
    0,
  );
  runLog.append(
    formatOverallSummary({
      guildsTotal: outcomes.length,
      guildsSucceeded: outcomes.filter((o) => o.status === 'ok').length,
      guildsFailed: outcomes.filter((o) => o.status === 'failed').length,
      cleanupTotal: cleanupTotalAll,
      upsertedTotal,
      botDeletedTotal,
      skippedNullAuthorTotal,
      skippedAttachmentsTotal,
      skippedReactionsTotal,
      skippedStickersTotal,
      startedAt,
      finishedAt,
      elapsedMs,
      breakdown: buildBreakdown(outcomes),
    }),
  );
  runLog.append(formatEndOfRun(anyFailed ? 'FAILED' : 'COMPLETED'));

  // Overview pino lines — one per guild for the operator's stdout view.
  logger.info({}, '==== msg_backup overview ====');
  for (const o of outcomes) {
    const totals = sumChannelStats(o.channelOutcomes);
    logger.info(
      {
        guildId: o.guildId,
        guildName: o.guildName,
        status: o.status,
        upserted: totals.upserted,
        deletedBot: totals.deletedBot,
        skippedNullAuthor: totals.skippedNullAuthor,
        skippedAttachments: totals.skippedAttachments,
        skippedReactions: totals.skippedReactions,
        skippedStickers: totals.skippedStickers,
        channelsProcessed: o.channelOutcomes.filter(
          (c) => c.status === 'ok' || c.status === 'retried-but-ok',
        ).length,
        cleanupTotal: cleanupTotal(o.cleanup),
        ...(o.error !== undefined ? { error: o.error } : {}),
      },
      o.status === 'ok' ? 'msg_backup: guild ok' : 'msg_backup: guild FAILED',
    );
  }

  runLog.close();
  if (runLog.wasBroken()) {
    process.stderr.write(
      '[msg_backup] WARNING: per-run log file became unwritable during this run. ' +
        'Inspect the partial file at ' +
        runLog.filePath +
        ' and stderr above for the rest of the output.\n',
    );
  }
  process.exitCode = anyFailed ? 1 : 0;
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[msg_backup] FATAL: ${message}\n`);
  process.exit(1);
});
