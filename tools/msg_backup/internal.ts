/**
 * Pure, unit-testable internals for `msg_backup`. The main entry point
 * (`msg_backup.ts`) wires Discord / Mongo lifecycle, run-log files, and
 * the per-guild orchestration; the helpers here are extracted so
 * `msg_backup.test.ts` can exercise them without booting either.
 *
 * Everything here is referentially transparent given its arguments —
 * no module-level mutable state, no file I/O, no Discord/Mongo handle
 * leakage. `parseConfig` reads a file path the caller injects (tests
 * point at fixture files; the runtime entry passes the real
 * `tools/msg_backup/config.json`).
 */
import { readFileSync } from 'node:fs';

import { DiscordAPIError, type Message } from 'discord.js';

import { ConfigurationError } from '../../src/core/errors/configuration-error';

// ---------- Config ----------

export interface ToolConfig {
  readonly mongoUri: string;
  readonly discordToken: string;
  /** Local-time `YYYY-MM-DD`, or `undefined` for "no lower bound". */
  readonly startDate: string | undefined;
  readonly guilds: readonly string[];
  readonly deleteBotMessages: boolean;
  readonly batchSize: number;
}

const configError = (configPath: string, field: string, reason: string): ConfigurationError =>
  new ConfigurationError({
    code: 'INVALID_CONFIG_JSON',
    messageKey: 'errors:config.invalid',
    context: {
      operation: 'msg_backup.parseConfig',
      input: { configPath, field, reason },
    },
  });

/**
 * Parse the operator-supplied `config.json`. Path is injected so unit
 * tests can point at fixture files rather than the gitignored real
 * config. Normalises `mongo_uri` to the host-only-with-trailing-slash
 * shape `MongoConnectionManager.buildGuildMongoUri` expects: any query
 * string is stripped and a single trailing slash is re-asserted. This
 * tolerates operators pasting either `mongodb://host/` or
 * `mongodb://host/?authSource=admin` without producing a malformed URI
 * once the per-guild DB name + `?authSource=admin` is appended downstream.
 */
export const parseConfig = (configPath: string): ToolConfig => {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigurationError({
      code: 'MISSING_ENV',
      messageKey: 'errors:config.missing',
      context: {
        operation: 'msg_backup.parseConfig',
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
        operation: 'msg_backup.parseConfig',
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

  const discordToken = obj['discord_token'];
  if (typeof discordToken !== 'string' || discordToken.length === 0) {
    throw configError(configPath, 'discord_token', 'must be a non-empty string');
  }

  const startDateRaw = obj['start_date'];
  let startDate: string | undefined;
  if (startDateRaw === undefined || startDateRaw === '') {
    startDate = undefined;
  } else if (typeof startDateRaw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDateRaw)) {
    throw configError(configPath, 'start_date', 'must be "" or a YYYY-MM-DD string');
  } else {
    const probe = parseLocalMidnight(startDateRaw);
    if (probe === undefined) {
      throw configError(configPath, 'start_date', `"${startDateRaw}" is not a valid calendar date`);
    }
    startDate = startDateRaw;
  }

  const guildsRaw = obj['guilds'];
  if (!Array.isArray(guildsRaw) || guildsRaw.length === 0) {
    throw configError(
      configPath,
      'guilds',
      'must be a non-empty array of guild id strings (empty array fallback was removed)',
    );
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

  const deleteBotMessagesRaw = obj['delete_bot_messages'];
  let deleteBotMessages = true;
  if (deleteBotMessagesRaw !== undefined) {
    if (typeof deleteBotMessagesRaw !== 'boolean') {
      throw configError(configPath, 'delete_bot_messages', 'must be a boolean');
    }
    deleteBotMessages = deleteBotMessagesRaw;
  }

  // Default raised from 100 → 500: with the unconditional-upsert path
  // each batch is one bulkWrite, and 500 sits at the throughput sweet
  // spot for the Mongo driver while keeping crash loss to one batch.
  const batchSizeRaw = obj['batch_size'];
  let batchSize = 500;
  if (batchSizeRaw !== undefined) {
    if (typeof batchSizeRaw !== 'number' || !Number.isInteger(batchSizeRaw) || batchSizeRaw <= 0) {
      throw configError(configPath, 'batch_size', 'must be a positive integer');
    }
    batchSize = batchSizeRaw;
  }

  return { mongoUri, discordToken, startDate, guilds, deleteBotMessages, batchSize };
};

// ---------- Time helpers (all LOCAL time) ----------

/** Parse `YYYY-MM-DD` into local-midnight epoch ms, or undefined on invalid. */
export const parseLocalMidnight = (ymd: string): number | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (m === null) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const dt = new Date(year, month, day, 0, 0, 0, 0);
  if (dt.getFullYear() !== year || dt.getMonth() !== month || dt.getDate() !== day) {
    return undefined;
  }
  return dt.getTime();
};

export const monthKey = (epochMs: number): string => {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

// ---------- Retry / transient classification ----------

export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

const TRANSIENT_NODE_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENOTFOUND',
]);

/** HTTP statuses we consider transient on `messages.fetch`. */
const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/**
 * Discord error codes (NOT HTTP statuses) that are definitively
 * non-transient — retrying would never help and would just waste
 * the budget. These bypass `isTransientError` entirely.
 */
const NON_TRANSIENT_DISCORD_CODES: ReadonlySet<number> = new Set([
  10003, // Unknown Channel
  10004, // Unknown Guild
  10008, // Unknown Message
  50001, // Missing Access
  50013, // Missing Permissions
  50021, // Cannot execute action on a system message
  50035, // Invalid Form Body
]);

/**
 * Heuristic for whether an error from `messages.fetch` should be
 * retried. Decision tree:
 *   1. DiscordAPIError with a code in the non-transient blacklist → never retry.
 *   2. DiscordAPIError with an HTTP status in the transient set → retry.
 *   3. Node-level error with a known transient `code` → retry.
 *   4. Otherwise → do not retry. The string-regex fallback the old
 *      implementation used is gone: matching `"timeout"` against
 *      arbitrary error messages produces too many false positives.
 */
export const isTransientError = (err: unknown): boolean => {
  if (err instanceof DiscordAPIError) {
    const codeNum = typeof err.code === 'number' ? err.code : Number(err.code);
    if (!Number.isNaN(codeNum) && NON_TRANSIENT_DISCORD_CODES.has(codeNum)) {
      return false;
    }
    return TRANSIENT_HTTP_STATUSES.has(err.status);
  }
  if (err === null || typeof err !== 'object') return false;
  const e = err as { readonly code?: unknown; readonly status?: unknown };
  if (typeof e.code === 'string' && TRANSIENT_NODE_CODES.has(e.code)) return true;
  if (typeof e.status === 'number' && TRANSIENT_HTTP_STATUSES.has(e.status)) return true;
  return false;
};

/**
 * Wrap `fn` in an exponential backoff retry loop (`RETRY_DELAYS_MS`).
 * Only `isTransientError`-positive failures are retried; everything
 * else is rethrown immediately. `onRetry` is invoked once per retry
 * with a pre-formatted log line — the orchestrator uses it to bump the
 * `retriesObserved` counter and append a `[HH:MM:SS] Retry N/3 ...`
 * line to the per-run log.
 *
 * `sleep` is injectable so unit tests can run the loop without burning
 * real wall-clock time.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  context: string,
  onRetry: (line: string) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise<void>((r) => setTimeout(r, ms)),
): Promise<T> => {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const lastAttempt = attempt === RETRY_DELAYS_MS.length;
      if (!isTransientError(err) || lastAttempt) {
        throw err;
      }
      const delayMs = RETRY_DELAYS_MS[attempt] ?? 0;
      const reason = err instanceof Error ? err.message : String(err);
      onRetry(
        `Retry ${String(attempt + 1)}/${String(RETRY_DELAYS_MS.length)} in ` +
          `${(delayMs / 1000).toFixed(1)}s for ${context} after: ${reason}`,
      );
      await sleep(delayMs);
    }
  }
  throw new Error('msg_backup.withRetry: unreachable');
};

// ---------- buildBackfillDoc ----------

/**
 * Minimal subset of `discord.js`'s channel surface that
 * `buildBackfillDoc` actually uses. Defined here (rather than imported
 * as `GuildTextBasedChannel`) so unit tests can construct a literal
 * matching this contract without instantiating a full discord.js
 * channel.
 */
export interface BackfillChannelLike {
  readonly id: string;
  readonly name?: unknown;
}

const channelDisplayName = (channel: BackfillChannelLike): string =>
  typeof channel.name === 'string' ? channel.name : channel.id;

export interface BackfillDoc {
  /**
   * Plain object to feed into `$set`. Nested arrays are OMITTED when
   * any of their elements has a critical null field. Mongo's `$set`
   * with a missing key preserves the DB-side value, so the caller's
   * `bulkWrite` is safe to apply unconditionally.
   */
  readonly doc: Record<string, unknown>;
  /** True when the corresponding nested array was suppressed. */
  readonly skipped: {
    readonly attachments: boolean;
    readonly reactions: boolean;
    readonly stickers: boolean;
  };
}

/**
 * Build the `$set` payload for one Discord `Message`.
 *
 * Top-level scalar fields (channelId, content, userId, userName,
 * timestamp, ...) are always written — Discord guarantees those for
 * any author-bearing message. The three nested arrays
 * (`attachments` / `reactions` / `stickers`) are subject to the
 * field-skip guarantee: if any element carries a critical `null`
 * (typically attachment.name on a deleted-webhook message, or a
 * sticker.name from a removed third-party pack), the **entire array
 * is omitted from the doc** so the DB-side value is preserved.
 *
 * Why omit the whole array (not just the bad element):
 *   - Mongo `$set` cannot do partial-array merge; writing a filtered
 *     subset would still overwrite the DB array and lose any
 *     elements the DB had that Discord did not return this time.
 *   - These edge messages are very rare; preserving the DB's prior
 *     (likely-also-edge) state is the safer default than substituting
 *     `''` placeholders.
 *
 * Caller has already filtered `msg.author === null`.
 */
export const buildBackfillDoc = (msg: Message, channel: BackfillChannelLike): BackfillDoc => {
  const author = msg.author;
  const doc: Record<string, unknown> = {
    channelId: channel.id,
    channelName: channelDisplayName(channel),
    content: msg.content,
    messageId: msg.id,
    userId: author.id,
    userName: author.username,
    timestamp: msg.createdTimestamp,
  };
  const skipped = { attachments: false, reactions: false, stickers: false };

  let attachmentArr: Array<Record<string, unknown>> | null = [];
  for (const a of msg.attachments.values()) {
    if (a.name === null || a.name === undefined) {
      attachmentArr = null;
      break;
    }
    attachmentArr.push({
      id: a.id,
      name: a.name,
      url: a.url,
      contentType: a.contentType ?? undefined,
    });
  }
  if (attachmentArr === null) {
    skipped.attachments = true;
  } else {
    doc['attachments'] = attachmentArr;
  }

  let reactionArr: Array<Record<string, unknown>> | null = [];
  for (const r of msg.reactions.cache.values()) {
    if (r.emoji.name === null || r.emoji.name === undefined) {
      reactionArr = null;
      break;
    }
    reactionArr.push({
      id: r.emoji.id ?? undefined,
      name: r.emoji.name,
      animated: r.emoji.animated ?? false,
      count: r.count,
      userIds: r.users.cache.map((u) => u?.id ?? '').filter((id) => id !== ''),
    });
  }
  if (reactionArr === null) {
    skipped.reactions = true;
  } else {
    doc['reactions'] = reactionArr;
  }

  let stickerArr: Array<Record<string, unknown>> | null = [];
  for (const s of msg.stickers.values()) {
    if (s.name === null || s.name === undefined) {
      stickerArr = null;
      break;
    }
    stickerArr.push({ id: s.id, name: s.name });
  }
  if (stickerArr === null) {
    skipped.stickers = true;
  } else {
    doc['stickers'] = stickerArr;
  }

  return { doc, skipped };
};

// ---------- Anomaly synthesis ----------

export interface AnomalyChannelStats {
  readonly upserted: number;
  readonly deletedBot: number;
  readonly skippedNullAuthor: number;
  readonly skippedAttachments: number;
  readonly skippedReactions: number;
  readonly skippedStickers: number;
  readonly processed: number;
}

export type ChannelOutcomeStatus =
  | 'ok'
  | 'aborted'
  | 'no-permission'
  | 'channel-not-found'
  | 'guild-not-accessible'
  | 'cursor-persist-failed'
  | 'thread-enum-failed'
  | 'retried-but-ok';

export interface ChannelOutcomeLike {
  readonly channelId: string;
  readonly channelName: string;
  readonly status: ChannelOutcomeStatus;
  readonly reason?: string;
  readonly stats: AnomalyChannelStats;
}

export type AnomalyStatus =
  | 'aborted'
  | 'no-permission'
  | 'channel-not-found'
  | 'guild-not-accessible'
  | 'cursor-persist-failed'
  | 'thread-enum-failed'
  | 'retried-but-ok'
  | 'field-skip-ok';

export interface AnomalyEntryOut {
  readonly status: AnomalyStatus;
  readonly channelName: string;
  readonly channelId: string;
  readonly reason: string;
  readonly partialUpserted?: number;
  readonly note?: string;
}

const STATUS_LABELS: Readonly<Record<AnomalyStatus, true>> = {
  aborted: true,
  'no-permission': true,
  'channel-not-found': true,
  'guild-not-accessible': true,
  'cursor-persist-failed': true,
  'thread-enum-failed': true,
  'retried-but-ok': true,
  'field-skip-ok': true,
};

const hasFieldSkip = (s: AnomalyChannelStats): boolean =>
  s.skippedAttachments > 0 || s.skippedReactions > 0 || s.skippedStickers > 0;

const fieldSkipNote = (s: AnomalyChannelStats): string => {
  const parts: string[] = [];
  if (s.skippedAttachments > 0) parts.push(`${String(s.skippedAttachments)} attachments`);
  if (s.skippedReactions > 0) parts.push(`${String(s.skippedReactions)} reactions`);
  if (s.skippedStickers > 0) parts.push(`${String(s.skippedStickers)} stickers`);
  return `preserved DB values on ${parts.join(', ')} (Discord returned null fields)`;
};

/**
 * Compute the per-guild Anomaly list for the summary block. Status
 * precedence: a `retried-but-ok` channel that also tripped field-skip
 * is reported as `retried-but-ok` only — transport flakiness matters
 * more to operators than per-message edge cases. A plain `ok` channel
 * with any field-skip is surfaced as `field-skip-ok` so the
 * preservation event is auditable.
 */
export const buildAnomalies = (
  outcomes: readonly ChannelOutcomeLike[],
): readonly AnomalyEntryOut[] => {
  const list: AnomalyEntryOut[] = [];
  for (const c of outcomes) {
    if (c.status === 'ok') {
      if (!hasFieldSkip(c.stats)) continue;
      list.push({
        status: 'field-skip-ok',
        channelName: c.channelName,
        channelId: c.channelId,
        reason: fieldSkipNote(c.stats),
        note: 'ok, DB values preserved on the noted fields',
      });
      continue;
    }
    if (!(c.status in STATUS_LABELS)) continue;
    const entry: AnomalyEntryOut = {
      status: c.status as AnomalyStatus,
      channelName: c.channelName,
      channelId: c.channelId,
      reason: c.reason ?? '(no reason recorded)',
      ...(c.status === 'aborted' && c.stats.upserted > 0
        ? { partialUpserted: c.stats.upserted }
        : {}),
      ...(c.status === 'retried-but-ok' ? { note: 'ok, just transient' } : {}),
    };
    list.push(entry);
  }
  return list;
};
