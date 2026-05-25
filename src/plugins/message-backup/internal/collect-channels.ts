/**
 * Walk every text-like channel + thread in `guild` and return the
 * union as a flat `TextBasedChannel[]`. Active threads come from
 * `fetchActive`; archived public + private threads drain through
 * `fetchArchived` until `hasMore === false`.
 *
 * The result feeds `backupChannel`. Errors on individual thread-page
 * fetches log + continue rather than aborting the whole walk —
 * partial coverage is better than zero coverage when one channel is
 * misbehaving.
 */
import { ChannelType, type Guild, type TextBasedChannel } from 'discord.js';

import { logError, type Logger } from '../../../core/logger';
import { retryFetch } from './retry';

const ALLOWED_CHANNEL_TYPES = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

export const collectChannels = async (
  guild: Guild,
  clientId: string,
  logger: Logger,
): Promise<{ channels: TextBasedChannel[]; liveChannelIds: Set<string> }> => {
  await guild.channels.fetch();
  const channels: TextBasedChannel[] = [];
  const liveChannelIds = new Set<string>();
  const seen = new Set<string>();

  const addChannel = (ch: unknown): void => {
    const anyCh = ch as { id?: string; type?: number; messages?: { fetch?: unknown } };
    if (anyCh === null || anyCh === undefined) return;
    if (anyCh.id === undefined || seen.has(anyCh.id)) return;
    if (typeof anyCh.type !== 'number' || !ALLOWED_CHANNEL_TYPES.has(anyCh.type)) return;
    seen.add(anyCh.id);
    liveChannelIds.add(anyCh.id);
    if (anyCh.messages !== undefined && typeof anyCh.messages.fetch === 'function') {
      channels.push(ch as TextBasedChannel);
    }
  };

  for (const channel of guild.channels.cache.values()) {
    addChannel(channel);
    const anyChannel = channel as unknown as {
      threads?: {
        fetchActive?: () => Promise<{ threads: Map<string, unknown> }>;
        fetchArchived?: (opts: unknown) => Promise<{
          threads: Map<string, { archivedAt: Date | null }>;
          hasMore: boolean;
        }>;
      };
      name?: string;
    };
    if (anyChannel.threads === undefined || typeof anyChannel.threads.fetchActive !== 'function') {
      continue;
    }
    try {
      const active = await retryFetch(() => anyChannel.threads!.fetchActive!());
      active.threads.forEach((t) => addChannel(t));
    } catch (err) {
      logError(
        logger,
        clientId,
        guild.id,
        `fetchActive threads failed for ${anyChannel.name ?? channel.id}: ${String(err)}`,
      );
    }
    for (const type of ['public', 'private'] as const) {
      try {
        let before: Date | undefined;
        // fetchArchived is paginated — drain both visibility classes.
        for (;;) {
          const opts: { type: 'public' | 'private'; limit: number; fetchAll: boolean; before?: Date } = {
            type,
            limit: 100,
            fetchAll: type === 'private',
          };
          if (before !== undefined) opts.before = before;
          const archived = await retryFetch(() => anyChannel.threads!.fetchArchived!(opts));
          archived.threads.forEach((t) => {
            addChannel(t);
            const archivedAt = (t as { archivedAt: Date | null }).archivedAt;
            if (archivedAt !== null && (before === undefined || archivedAt < before)) {
              before = archivedAt;
            }
          });
          if (!archived.hasMore) break;
        }
      } catch (err) {
        logError(
          logger,
          clientId,
          guild.id,
          `fetchArchived ${type} threads failed for ${anyChannel.name ?? channel.id}: ${String(err)}`,
        );
      }
    }
  }
  return { channels, liveChannelIds };
};
