/**
 * Minimal GuildMember builder. Tests need this shape to feed
 * `interaction.member` and `guild.members.cache.get`.
 */
import type { GuildMember } from 'discord.js';

export interface BuildGuildMemberInput {
  readonly id?: string;
  readonly displayName?: string;
  readonly username?: string;
  readonly voiceChannelId?: string | null;
  readonly roleIds?: readonly string[];
}

export const buildGuildMember = (input: BuildGuildMemberInput = {}): GuildMember => {
  const id = input.id ?? 'u-1';
  const roleCache = new Map<string, unknown>();
  for (const rid of input.roleIds ?? []) {
    roleCache.set(rid, { id: rid });
  }
  return {
    id,
    displayName: input.displayName ?? input.username ?? 'tester',
    user: {
      id,
      username: input.username ?? 'tester',
      displayName: input.displayName ?? input.username ?? 'tester',
      bot: false,
      displayAvatarURL: () => `https://cdn.example/${id}.png`,
    },
    voice: { channelId: input.voiceChannelId ?? null },
    roles: { cache: roleCache },
  } as unknown as GuildMember;
};
