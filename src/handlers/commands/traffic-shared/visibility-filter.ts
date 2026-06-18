/**
 * Dual privacy filter for `/traffic`. A channel's statistics may be
 * shown only when BOTH gates pass:
 *   (a) operator rank gate — `channelRank <= ceiling`, where the
 *       ceiling is the invoker's `visibilityCeiling` (ephemeral mode)
 *       or `0` / public (public mode);
 *   (b) Discord-native `ViewChannel` — for the invoking member
 *       (ephemeral) or the `@everyone` role (public).
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
  type Role,
} from 'discord.js';
import type { PermissionRankPolicy } from '@core/plugin';

import { parentChannelIdOf } from '../../../infra/discord';

import type { Visibility } from './types';

export interface VisibilityFilterInput {
  readonly guild: Guild;
  readonly member: GuildMember;
  readonly policy: PermissionRankPolicy;
  readonly mode: Visibility;
  readonly commandChannelId: string;
}

/** Rank ceiling for public mode: only rank-0 (public / unlisted) channels. */
const PUBLIC_RANK_CEILING = 0;

const THREAD_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

/**
 * Native `ViewChannel` check. A thread inherits its parent's
 * visibility, so the parent is the permission source when present.
 */
const canView = (channel: GuildBasedChannel, subject: GuildMember | Role): boolean => {
  const target = THREAD_TYPES.has(channel.type) && channel.parent ? channel.parent : channel;
  if (!('permissionsFor' in target)) return false;
  const perms = target.permissionsFor(subject);
  return perms !== null && perms.has(PermissionFlagsBits.ViewChannel);
};

export const buildAllowedChannelSet = (input: VisibilityFilterInput): ReadonlySet<string> => {
  const { guild, member, policy, mode, commandChannelId } = input;
  const commandChannel = guild.channels.cache.get(commandChannelId) ?? null;

  const ceiling =
    mode === 'public'
      ? PUBLIC_RANK_CEILING
      : policy.visibilityCeiling(
          guild.id,
          member.roles.cache.keys(),
          commandChannelId,
          parentChannelIdOf(commandChannel),
        );
  const subject: GuildMember | Role = mode === 'public' ? guild.roles.everyone : member;

  const allowed = new Set<string>();
  for (const [channelId, channel] of guild.channels.cache) {
    if (policy.channelRank(guild.id, channelId, parentChannelIdOf(channel)) > ceiling) continue;
    if (canView(channel, subject)) allowed.add(channelId);
  }
  return allowed;
};
