/**
 * Backup one channel's full history into the message store. Picks
 * between incremental mode (resume from the persisted
 * `Fetch.lastMessageID`) and full mode (drain backward from the head)
 * based on whether a Fetch doc already exists for this channel.
 *
 * Errors abort the channel but never the surrounding guild loop —
 * `stats.error` records what went wrong and the per-guild log file
 * picks it up.
 */
import type { TextBasedChannel } from 'discord.js';

import { logError, type Logger } from '../../../core/logger';
import type { Repos } from '../../../persistence/repositories';
import { retryFetch } from '../../../core/retry';
import { saveBatch, type BatchResult } from './save-batch';

export interface ChannelBackupStats {
  channelId: string;
  channelName: string;
  mode: 'incremental' | 'full';
  resumeFromMsgId?: string;
  startMsgId?: string;
  startMsgContent?: string;
  endMsgId?: string;
  endMsgContent?: string;
  newMessages: number;
  totalFetched: number;
  skippedBots: number;
  skippedDuplicates: number;
  batches: number;
  durationMs: number;
  error?: string;
}

export const backupChannel = async (
  channel: TextBasedChannel,
  repos: Repos,
  guildId: string,
  logger: Logger,
  onProgress: () => Promise<void>,
): Promise<{ added: number; stats: ChannelBackupStats }> => {
  type FetchOpts = { limit: number; before?: string; after?: string };
  type FetchResult = { size: number; values(): Iterable<unknown> };
  const ch = channel as unknown as {
    id: string;
    name?: string;
    messages: { fetch: (opts: FetchOpts) => Promise<FetchResult> };
  };
  const startTime = Date.now();
  const stats: ChannelBackupStats = {
    channelId: ch.id,
    channelName: ch.name ?? '',
    mode: 'full',
    newMessages: 0,
    totalFetched: 0,
    skippedBots: 0,
    skippedDuplicates: 0,
    batches: 0,
    durationMs: 0,
  };

  try {
    // Repo methods return Result<T, DatabaseError>. An `err` is
    // re-thrown so the channel-level catch records it on `stats.error`.
    const fetchRecordResult = await repos.fetch.findByChannelId(ch.id);
    if (!fetchRecordResult.ok) throw fetchRecordResult.error;
    let fetchRecord = fetchRecordResult.value;
    if (fetchRecord === undefined) {
      const createResult = await repos.fetch.create(ch.name ?? '', ch.id, '');
      if (!createResult.ok) throw createResult.error;
      fetchRecord = createResult.value;
    }
    const lastMessageID = fetchRecord.lastMessageID ?? '';
    let latestMessageId: string | undefined;
    let globalOldest: { id: string; content: string } | undefined;
    let globalNewest: { id: string; content: string } | undefined;

    const updateGlobalBounds = (batch: BatchResult): void => {
      if (batch.oldestMsg !== undefined) {
        if (globalOldest === undefined || BigInt(batch.oldestMsg.id) < BigInt(globalOldest.id)) {
          globalOldest = batch.oldestMsg;
        }
      }
      if (batch.newestMsg !== undefined) {
        if (globalNewest === undefined || BigInt(batch.newestMsg.id) > BigInt(globalNewest.id)) {
          globalNewest = batch.newestMsg;
        }
      }
    };

    if (lastMessageID.length > 0) {
      stats.mode = 'incremental';
      stats.resumeFromMsgId = lastMessageID;
      let cursor = lastMessageID;
      for (;;) {
        const fetched = await retryFetch(() => ch.messages.fetch({ limit: 100, after: cursor }));
        if (fetched.size === 0) break;
        const batch = await saveBatch(fetched, ch, repos.message);
        stats.batches += 1;
        stats.totalFetched += fetched.size;
        stats.newMessages += batch.inserted;
        stats.skippedBots += batch.skippedBots;
        stats.skippedDuplicates += batch.skippedDuplicates;
        updateGlobalBounds(batch);
        if (batch.inserted > 0) await onProgress();
        if (batch.newestId !== undefined) {
          latestMessageId = batch.newestId;
          cursor = batch.newestId;
        }
        if (fetched.size < 100) break;
      }
    } else {
      let cursor: string | undefined;
      for (;;) {
        const opts: { limit: number; before?: string } = { limit: 100 };
        if (cursor !== undefined) opts.before = cursor;
        const fetched = await retryFetch(() => ch.messages.fetch(opts));
        if (fetched.size === 0) break;
        const batch = await saveBatch(fetched, ch, repos.message);
        stats.batches += 1;
        stats.totalFetched += fetched.size;
        stats.newMessages += batch.inserted;
        stats.skippedBots += batch.skippedBots;
        stats.skippedDuplicates += batch.skippedDuplicates;
        updateGlobalBounds(batch);
        if (batch.inserted > 0) await onProgress();
        if (latestMessageId === undefined && batch.newestId !== undefined) {
          latestMessageId = batch.newestId;
        }
        if (batch.oldestId !== undefined) cursor = batch.oldestId;
        if (fetched.size < 100) break;
      }
    }

    if (latestMessageId !== undefined) {
      const upsertResult = await repos.fetch.upsertLastMessageID(
        ch.name ?? '',
        ch.id,
        latestMessageId,
      );
      if (!upsertResult.ok) throw upsertResult.error;
    }
    stats.startMsgId = globalOldest?.id;
    stats.startMsgContent = globalOldest?.content;
    stats.endMsgId = globalNewest?.id;
    stats.endMsgContent = globalNewest?.content;
  } catch (err: unknown) {
    stats.error = String(err);
    logError(logger, guildId, `Failed to backup channel ${ch.name ?? ch.id}: ${String(err)}`);
  }
  stats.durationMs = Date.now() - startTime;
  return { added: stats.newMessages, stats };
};
