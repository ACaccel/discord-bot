import type { Collection, Guild, GuildMember } from 'discord.js';

import type { MemberSource } from './resolve-targets';

/**
 * Build the {@link MemberSource} the handler injects: a thin adapter over a
 * guild and its already-fetched members. Role expansion excludes bots and
 * orders each role's members by display name for a stable announcement. This
 * is the only Discord-coupled part of the resolver; the resolver itself
 * stays pure.
 */
export const createGuildMemberSource = (
  guild: Guild,
  members: Collection<string, GuildMember>,
): MemberSource => ({
  guildId: guild.id,
  getMember: (userId) => members.get(userId),
  roleExists: (roleId) => guild.roles.cache.has(roleId),
  membersOfRole: (roleId) =>
    [...members.values()]
      .filter((member) => member.roles.cache.has(roleId) && !member.user.bot)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hant')),
});
