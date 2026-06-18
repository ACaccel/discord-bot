/**
 * Minimal Guild builder for unit / integration tests. Returns the
 * structural subset that handler / plugin code touches — id, name,
 * `channels.cache`, `members.cache`. Tests that need more can spread
 * extra fields into the return.
 */
import type { Guild } from 'discord.js';

interface BuildGuildInput {
  readonly id?: string;
  readonly name?: string;
  /** Pre-populated channel cache. Tests pass channels built by `buildTextChannel`. */
  readonly channels?: readonly { id: string; name?: string; type?: number }[];
  /** Pre-populated member cache. Tests pass members built by `buildGuildMember`. */
  readonly members?: readonly { id: string; displayName?: string }[];
  /** Id of the synthetic `@everyone` role exposed at `roles.everyone`. */
  readonly everyoneRoleId?: string;
}

export const buildGuild = (input: BuildGuildInput = {}): Guild => {
  const channelCache = new Map<string, unknown>();
  for (const ch of input.channels ?? []) {
    channelCache.set(ch.id, ch);
  }
  const memberCache = new Map<string, unknown>();
  for (const m of input.members ?? []) {
    memberCache.set(m.id, m);
  }
  const everyoneId = input.everyoneRoleId ?? 'everyone';
  return {
    id: input.id ?? 'g-1',
    name: input.name ?? 'TestGuild',
    channels: { cache: channelCache },
    members: { cache: memberCache },
    roles: { everyone: { id: everyoneId } },
  } as unknown as Guild;
};
