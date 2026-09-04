/**
 * Minimal Guild builder for unit / integration tests. Returns the
 * structural subset that handler / plugin code touches — id, name,
 * `channels.cache`, `members.cache`, `roles`. Tests that need more can
 * spread extra fields into the return.
 */
import { vi, type Mock } from 'vitest';
import type { Guild, GuildBasedChannel } from 'discord.js';

/**
 * Role manager stand-in. `create` / `delete` stay `vi.fn()` mocks
 * rather than call-recording arrays so a test can drive the failure
 * branches with `mockRejectedValue`.
 */
interface GuildRolesFake {
  /** Backs both `roles.cache.size` (role-ceiling checks) and `.get(id)`. */
  readonly cache: Map<string, { readonly id: string; readonly name: string }>;
  readonly create: Mock;
  readonly delete: Mock;
  readonly everyone: { readonly id: string };
}

interface BuildGuildRolesInput {
  /** How many roles the guild already has; drives `roles.cache.size`. */
  readonly roleCount?: number;
  /** Roles resolvable by id through `roles.cache.get`. */
  readonly roles?: readonly { readonly id: string; readonly name: string }[];
  /** Id of the role `roles.create` resolves with. */
  readonly createdRoleId?: string;
  readonly everyoneRoleId?: string;
}

export const buildGuildRoles = (input: BuildGuildRolesInput = {}): GuildRolesFake => {
  const cache = new Map<string, { id: string; name: string }>();
  for (let i = 0; i < (input.roleCount ?? 0); i += 1) {
    cache.set(`filler-${String(i)}`, { id: `filler-${String(i)}`, name: `filler-${String(i)}` });
  }
  for (const role of input.roles ?? []) {
    cache.set(role.id, { id: role.id, name: role.name });
  }
  return {
    cache,
    create: vi.fn().mockResolvedValue({ id: input.createdRoleId ?? 'role-1' }),
    delete: vi.fn().mockResolvedValue(undefined),
    everyone: { id: input.everyoneRoleId ?? 'everyone' },
  };
};

interface BuildGuildInput {
  readonly id?: string;
  readonly name?: string;
  /**
   * Pre-populated channel cache. Typed as the real channel union rather
   * than `{ id }`, because callers read `isTextBased()` / `isSendable()`
   * / `permissionsFor()` off whatever the cache returns — a looser type
   * here would let a fixture compile and then fail at runtime.
   * Build entries with `buildTextChannel`.
   */
  readonly channels?: readonly GuildBasedChannel[];
  /** Pre-populated member cache. Tests pass members built by `buildGuildMember`. */
  readonly members?: readonly { id: string; displayName?: string }[];
  /**
   * The bot's own member (`guild.members.me`), which permission checks
   * on a target channel resolve against. `null` by default, the state a
   * handler must survive rather than assume away.
   */
  readonly me?: { readonly id: string } | null;
  /** Role manager from {@link buildGuildRoles}; defaults to an empty one. */
  readonly roles?: GuildRolesFake;
  /** Id of the synthetic `@everyone` role. Ignored when `roles` is given. */
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
  return {
    id: input.id ?? 'g-1',
    name: input.name ?? 'TestGuild',
    channels: { cache: channelCache },
    members: { cache: memberCache, me: input.me ?? null },
    roles: input.roles ?? buildGuildRoles({ everyoneRoleId: input.everyoneRoleId }),
  } as unknown as Guild;
};
