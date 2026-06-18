/**
 * Privacy filter for `/traffic`. A channel's statistics may be shown
 * only when BOTH gates pass:
 *   (a) operator rank gate — `channelRank <= ceiling`, where the ceiling
 *       depends on who will see the reply:
 *         - `public`  → `min(userRank, channelRank(commandChannel))`
 *           (the reply is posted to the room, so it is capped by BOTH the
 *           invoker's clearance and the command channel's own rank);
 *         - `ephemeral` → `userRank` (only the invoker sees the reply, so
 *           it is capped by their clearance alone — the command channel
 *           does not lower it);
 *   (b) Discord-native `ViewChannel` for the invoking member — a sanity
 *       gate so a channel the member cannot actually see is never shown.
 *
 * The set is built by walking the guild's live channel cache, so a
 * channel that survives only in archived message data (deleted or
 * uncached) is never added — fail-safe exclusion.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
} from 'discord.js';
import type { PermissionRankPolicy } from '@core/plugin';

import { ancestorChannelIdsOf } from '../../../infra/discord';

import type { Visibility } from './types';

export interface VisibilityFilterInput {
  readonly guild: Guild;
  readonly member: GuildMember;
  readonly policy: PermissionRankPolicy;
  readonly mode: Visibility;
  readonly commandChannelId: string;
}

const THREAD_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

/**
 * Native `ViewChannel` check for the invoking member. A thread inherits
 * its parent's visibility, so the parent is the permission source when
 * present.
 */
const canView = (channel: GuildBasedChannel, subject: GuildMember): boolean => {
  const target = THREAD_TYPES.has(channel.type) && channel.parent ? channel.parent : channel;
  if (!('permissionsFor' in target)) return false;
  const perms = target.permissionsFor(subject);
  return perms !== null && perms.has(PermissionFlagsBits.ViewChannel);
};

export const buildAllowedChannelSet = (input: VisibilityFilterInput): ReadonlySet<string> => {
  const { guild, member, policy, mode, commandChannelId } = input;
  const roleIds = member.roles.cache.keys();

  // A public reply is also capped by the command channel's rank; a
  // private (ephemeral) reply is capped by the invoker's clearance only.
  const ceiling =
    mode === 'public'
      ? policy.visibilityCeiling(
          guild.id,
          roleIds,
          commandChannelId,
          ancestorChannelIdsOf(
            guild.channels.cache.get(commandChannelId) ?? null,
            guild.channels.cache,
          ),
        )
      : policy.userRank(guild.id, roleIds);

  const allowed = new Set<string>();
  for (const [channelId, channel] of guild.channels.cache) {
    const ancestors = ancestorChannelIdsOf(channel, guild.channels.cache);
    if (policy.channelRank(guild.id, channelId, ancestors) > ceiling) continue;
    if (canView(channel, member)) allowed.add(channelId);
  }
  return allowed;
};
