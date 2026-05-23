import type { GuildMember, User } from 'discord.js';

import { fmtTimestamp, toText, truncate } from './format-helpers';

/**
 * Translator function signature compatible with `bot.translator.t`.
 * Accepting an injectable function (rather than the full Translator)
 * lets unit tests assert i18n keys without touching i18next.
 */
export type TFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Render the embed description for one inspected ID. The function is
 * a pure projection from (id, user, member, t) to string, so it can
 * be unit-tested against synthetic discord.js objects without going
 * near the network.
 */
export const buildMemberDescription = (
  id: string,
  user: User | null,
  member: GuildMember | null,
  t: TFn,
): string => {
  const yesNo = (b: boolean): string =>
    t(b ? 'replies:inspect_member_ids.yes' : 'replies:inspect_member_ids.no');

  if (!user && !member) {
    return [
      `**ID**: \`${id}\``,
      t('replies:inspect_member_ids.not_in_guild_line'),
      t('replies:inspect_member_ids.user_not_found_line'),
    ].join('\n');
  }

  const targetUser = member?.user ?? user;
  if (!targetUser) {
    return [`**ID**: \`${id}\``, t('replies:inspect_member_ids.parse_failed_line')].join('\n');
  }

  const userFlags = targetUser.flags?.toArray() ?? [];
  const avatarUrl = targetUser.displayAvatarURL({
    extension: 'png',
    forceStatic: false,
    size: 1024,
  });
  const bannerUrl = targetUser.bannerURL({ extension: 'png', size: 1024 });
  const roles = member
    ? member.roles.cache
        .filter((r) => r.id !== member.guild.id)
        .sort((a, b) => b.position - a.position)
    : null;
  const topRoles = roles
    ? roles
        .first(10)
        .map((r) => `<@&${r.id}>`)
        .join(', ')
    : 'N/A';

  const lines = [
    `**ID**: \`${targetUser.id}\``,
    t('replies:inspect_member_ids.profile_link_line', { id: targetUser.id }),
    t('replies:inspect_member_ids.in_guild_line', { value: yesNo(!!member) }),
    t('replies:inspect_member_ids.account_type_line', {
      value: targetUser.bot ? 'Bot' : 'User',
    }),
    `**Username**: ${toText(targetUser.username)}`,
    `**Global Name**: ${toText(targetUser.globalName)}`,
    `**Tag**: ${toText(targetUser.tag)}`,
    `**Mention**: <@${targetUser.id}>`,
    t('replies:inspect_member_ids.created_at_line', { value: fmtTimestamp(targetUser.createdAt) }),
    `**Avatar**: [Link](${avatarUrl})`,
    `**Banner**: ${bannerUrl ? `[Link](${bannerUrl})` : 'N/A'}`,
    `**Accent Color**: ${
      targetUser.accentColor ? `#${targetUser.accentColor.toString(16).padStart(6, '0')}` : 'N/A'
    }`,
    t('replies:inspect_member_ids.system_user_line', { value: yesNo(targetUser.system ?? false) }),
    `**Public Flags**: ${userFlags.length > 0 ? userFlags.join(', ') : 'None'}`,
    t('replies:inspect_member_ids.joined_at_line', {
      value: member ? fmtTimestamp(member.joinedAt) : 'N/A',
    }),
    t('replies:inspect_member_ids.display_name_line', {
      value: member ? toText(member.displayName) : 'N/A',
    }),
    t('replies:inspect_member_ids.timed_out_line', {
      value: member ? yesNo(member.isCommunicationDisabled()) : 'N/A',
    }),
    t('replies:inspect_member_ids.timeout_until_line', {
      value: member ? fmtTimestamp(member.communicationDisabledUntil) : 'N/A',
    }),
    t('replies:inspect_member_ids.pending_line', {
      value: member ? yesNo(member.pending ?? false) : 'N/A',
    }),
    t('replies:inspect_member_ids.highest_role_line', {
      value: member ? `<@&${member.roles.highest.id}>` : 'N/A',
    }),
    t('replies:inspect_member_ids.role_count_line', {
      value: roles ? String(roles.size) : 'N/A',
    }),
    t('replies:inspect_member_ids.top_roles_line', { value: topRoles }),
    t('replies:inspect_member_ids.boost_since_line', {
      value: member ? fmtTimestamp(member.premiumSince) : 'N/A',
    }),
    t('replies:inspect_member_ids.kickable_line', {
      value: member ? yesNo(member.kickable) : 'N/A',
    }),
    t('replies:inspect_member_ids.bannable_line', {
      value: member ? yesNo(member.bannable) : 'N/A',
    }),
  ];

  return truncate(lines.join('\n'));
};
