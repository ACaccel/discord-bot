import type { Guild } from 'discord.js';

import { ChannelType } from 'discord.js';

/**
 * Channel types whose transcript db_list_message supports. Lives next
 * to the handler (not in a shared file) because the membership of
 * this set is a per-command policy, not a global Discord truth.
 */
export const ARCHIVABLE_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
]);

/**
 * Returns a per-guild display-name resolver with an in-memory cache.
 * Keeping it as a factory lets the helper depend on the Discord Guild
 * type without leaking that dependency into formatMessageLines, which
 * stays Discord-free for easy unit testing.
 */
export const makeDisplayNameResolver = (
  guild: Guild,
): ((userId: string, fallback: string) => Promise<string>) => {
  const cache = new Map<string, string>();
  return async (userId, fallback) => {
    const cached = cache.get(userId);
    if (cached) return cached;
    try {
      const member = await guild.members.fetch(userId);
      const dn = member?.displayName || fallback;
      cache.set(userId, dn);
      return dn;
    } catch {
      cache.set(userId, fallback);
      return fallback;
    }
  };
};
