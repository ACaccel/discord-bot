/**
 * Unit tests for {@link GuildRegistrar} (R1 collaborator).
 *
 * Covers the §6.1 GuildRegistrar test plan from `docs/design/R1.md`:
 * happy path, partial config tolerance, empty config, missing cache
 * lookup, `registerAll` fan-out, fan-out resilience to a per-guild
 * throw, and the "no Mongo / no Discord send" purity invariant.
 */
import type { Channel, Client, Guild, Role } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { GuildRegistrar } from '../../../src/bot/guild-registrar';
import type { Config } from '../../../src/bot/index';
import { createLogger } from '../../../src/core/logger';

const silent = createLogger({ level: 'silent', pretty: false });

interface BuildGuildInput {
  readonly id: string;
  readonly name?: string;
  readonly memberDisplayName?: string;
  readonly roles?: ReadonlyArray<{ id: string; name?: string }>;
}

const buildGuild = (input: BuildGuildInput): Guild => {
  const roleCache = new Map<string, Role>();
  for (const role of input.roles ?? []) {
    roleCache.set(role.id, { id: role.id, name: role.name ?? role.id } as unknown as Role);
  }
  return {
    id: input.id,
    name: input.name ?? `Guild ${input.id}`,
    members: {
      cache: new Map([['bot-1', { displayName: input.memberDisplayName ?? 'Botty' }]]),
    },
    roles: { cache: roleCache },
  } as unknown as Guild;
};

const buildClient = (
  guilds: readonly Guild[],
  channels: ReadonlyArray<{ id: string; channel: Channel }> = [],
): Client => {
  const guildCache = new Map<string, Guild>();
  for (const g of guilds) guildCache.set(g.id, g);
  const channelCache = new Map<string, Channel>();
  for (const c of channels) channelCache.set(c.id, c.channel);
  return {
    guilds: { cache: guildCache },
    channels: { cache: channelCache },
  } as unknown as Client;
};

describe('GuildRegistrar.register', () => {
  it('populates channels and roles when the config is complete', () => {
    const guild = buildGuild({
      id: 'g-1',
      roles: [{ id: 'r-mod', name: 'mod' }],
    });
    const channel = { id: 'c-logs', name: 'logs' } as unknown as Channel;
    const client = buildClient([guild], [{ id: 'c-logs', channel }]);
    const config: Config = {
      guilds: {
        'g-1': {
          channels: { logs: 'c-logs' },
          roles: { mod: 'r-mod' },
        },
      },
    };

    const registrar = new GuildRegistrar(client, 'bot-1', silent);
    const info = registrar.register(guild, config);

    expect(info.bot_name).toBe('Botty');
    expect(info.channels).toEqual({ logs: channel });
    expect(info.roles?.mod?.id).toBe('r-mod');
  });

  it('omits missing channels rather than throwing', () => {
    const guild = buildGuild({ id: 'g-1' });
    const client = buildClient([guild]);
    const config: Config = {
      guilds: { 'g-1': { channels: { logs: 'nonexistent' }, roles: {} } },
    };

    const registrar = new GuildRegistrar(client, 'bot-1', silent);
    expect(() => registrar.register(guild, config)).not.toThrow();
    const info = registrar.register(guild, config);
    expect(info.channels?.['logs']).toBeUndefined();
  });

  it('returns empty channel / role maps when the guild has no config entry', () => {
    const guild = buildGuild({ id: 'g-1' });
    const client = buildClient([guild]);
    const registrar = new GuildRegistrar(client, 'bot-1', silent);
    const info = registrar.register(guild, {});
    expect(info.channels).toEqual({});
    expect(info.roles).toEqual({});
  });

  it('tolerates a guild entry that omits channels and roles entirely', () => {
    // The optional-channels contract: a `guilds.<id>` block may carry
    // neither `channels` nor `roles`. The bot keeps every feature but has
    // nothing to send to channel-bound side effects (debug / event mirror).
    const guild = buildGuild({ id: 'g-1' });
    const client = buildClient([guild]);
    const config: Config = { guilds: { 'g-1': {} } };
    const registrar = new GuildRegistrar(client, 'bot-1', silent);
    expect(() => registrar.register(guild, config)).not.toThrow();
    const info = registrar.register(guild, config);
    expect(info.channels).toEqual({});
    expect(info.roles).toEqual({});
  });

  it('omits a role whose id is not in the guild cache', () => {
    const guild = buildGuild({ id: 'g-1' });
    const client = buildClient([guild]);
    const config: Config = {
      guilds: { 'g-1': { channels: {}, roles: { ghost: 'r-missing' } } },
    };
    const registrar = new GuildRegistrar(client, 'bot-1', silent);
    const info = registrar.register(guild, config);
    expect(info.roles?.['ghost']).toBeUndefined();
  });

  it('does not call client.guilds.fetch or send any Discord message', () => {
    const guild = buildGuild({ id: 'g-1' });
    const fetchSpy = vi.fn();
    const client = {
      guilds: { cache: new Map([['g-1', guild]]), fetch: fetchSpy },
      channels: { cache: new Map() },
    } as unknown as Client;
    const registrar = new GuildRegistrar(client, 'bot-1', silent);
    registrar.register(guild, {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GuildRegistrar.registerAll', () => {
  it('produces one entry per guild in the cache', () => {
    const guilds = [
      buildGuild({ id: 'g-1' }),
      buildGuild({ id: 'g-2' }),
      buildGuild({ id: 'g-3' }),
    ];
    const client = buildClient(guilds);
    const registrar = new GuildRegistrar(client, 'bot-1', silent);

    const out = registrar.registerAll({});

    expect(Object.keys(out).sort()).toEqual(['g-1', 'g-2', 'g-3']);
  });

  it('continues iterating when one guild registration throws', () => {
    const goodA = buildGuild({ id: 'g-1' });
    const badGuild = {
      id: 'g-2',
      name: 'BadGuild',
      // `members.cache.get` throws to simulate a Discord SDK shape mismatch.
      members: {
        cache: {
          get: () => {
            throw new Error('cache exploded');
          },
        },
      },
      roles: { cache: new Map() },
    } as unknown as Guild;
    const goodB = buildGuild({ id: 'g-3' });
    const client = buildClient([goodA, badGuild, goodB]);
    const registrar = new GuildRegistrar(client, 'bot-1', silent);

    const out = registrar.registerAll({});

    expect(out['g-1']).toBeDefined();
    expect(out['g-2']).toBeUndefined();
    expect(out['g-3']).toBeDefined();
  });
});
