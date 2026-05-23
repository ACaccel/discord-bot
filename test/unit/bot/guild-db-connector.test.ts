/**
 * Unit tests for {@link GuildDbConnector} (R1 collaborator).
 *
 * Covers the §6.1 GuildDbConnector test plan from `docs/design/R1.md`:
 *   1. happy connectOne → repos populated
 *   2. ReposFactory throw → log w/ traceId + re-throw normalised Error
 *   3. ReposFactory throws non-Error → still normalised + re-thrown
 *   4. connectAll fan-out resilient to a per-slot throw
 *   5. connectAll short-circuits when MongoURI is undefined
 *   6. isDisabled pass-through; missing manager → undefined
 */
import type { Guild } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { GuildDbConnector } from '../../../src/bot/guild-db-connector';
import type { GuildInfo } from '../../../src/bot/index';
import { createContainer, TOKENS, type ReposFactory } from '../../../src/core/ioc';
import { createLogger } from '../../../src/core/logger';
import { DatabaseError } from '../../../src/core/errors/external-service-error';
import type { ConnectionManager } from '../../../src/infra/mongo/connection-manager';
import type { Repos } from '../../../src/persistence/repositories';

const silent = createLogger({ level: 'silent', pretty: false });

const fakeGuild = (id: string, name = `Guild ${id}`): Guild => ({ id, name }) as unknown as Guild;

const fakeRepos = (): Repos => ({}) as unknown as Repos;

const containerWith = (
  reposFactory?: ReposFactory,
  cm?: ConnectionManager,
): ReturnType<typeof createContainer> => {
  const c = createContainer();
  if (reposFactory !== undefined) {
    c.registerSingleton(TOKENS.ReposFactory, () => reposFactory);
  }
  if (cm !== undefined) {
    c.registerSingleton(TOKENS.ConnectionManager, () => cm);
  }
  return c;
};

describe('GuildDbConnector.connectOne', () => {
  it('populates slot.repos on success', async () => {
    const repos = fakeRepos();
    const factory: ReposFactory = vi.fn(async () => repos);
    const container = containerWith(factory);
    const connector = new GuildDbConnector(container, 'mongodb://x', 'bot-1', silent);
    const slot: GuildInfo = { bot_name: '', guild: fakeGuild('g-1') };

    await connector.connectOne('g-1', slot);

    expect(slot.repos).toBe(repos);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('re-throws a normalised Error when ReposFactory throws', async () => {
    const factory: ReposFactory = vi.fn(async () => {
      throw new Error('mongo unreachable');
    });
    const disabled = {
      traceId: 'trace-xyz',
      error: new DatabaseError({
        code: 'DATABASE_NETWORK',
        messageKey: 'errors:db.guild_disabled',
        messageParams: { traceId: 'trace-xyz' },
        context: { operation: 'GuildDbConnector.test', guildId: 'g-1' },
      }),
    };
    const cm: ConnectionManager = {
      isDisabled: () => disabled,
    } as unknown as ConnectionManager;
    const container = containerWith(factory, cm);
    const connector = new GuildDbConnector(container, 'mongodb://x', 'bot-1', silent);
    const slot: GuildInfo = { bot_name: '', guild: fakeGuild('g-1') };

    await expect(connector.connectOne('g-1', slot)).rejects.toThrow('mongo unreachable');
    expect(slot.repos).toBeUndefined();
  });

  it('normalises a non-Error throw into an Error before re-throwing', async () => {
    const factory: ReposFactory = vi.fn(async () => {
      // String throws are a real failure mode (e.g. older mongo drivers).
      throw 'mongo died';
    });
    const container = containerWith(factory);
    const connector = new GuildDbConnector(container, 'mongodb://x', 'bot-1', silent);
    const slot: GuildInfo = { bot_name: '', guild: fakeGuild('g-1') };

    await expect(connector.connectOne('g-1', slot)).rejects.toBeInstanceOf(Error);
  });
});

describe('GuildDbConnector.connectAll', () => {
  it('continues fanning out when one slot throws', async () => {
    const reposA = fakeRepos();
    const reposC = fakeRepos();
    const factory: ReposFactory = vi.fn(async (guildId) => {
      if (String(guildId) === 'g-2') throw new Error('boom');
      if (String(guildId) === 'g-1') return reposA;
      return reposC;
    });
    const container = containerWith(factory);
    const connector = new GuildDbConnector(container, 'mongodb://x', 'bot-1', silent);
    const guildInfo: Record<string, GuildInfo> = {
      'g-1': { bot_name: '', guild: fakeGuild('g-1') },
      'g-2': { bot_name: '', guild: fakeGuild('g-2') },
      'g-3': { bot_name: '', guild: fakeGuild('g-3') },
    };

    await connector.connectAll(guildInfo);

    expect(guildInfo['g-1']?.repos).toBe(reposA);
    expect(guildInfo['g-2']?.repos).toBeUndefined();
    expect(guildInfo['g-3']?.repos).toBe(reposC);
  });

  it('short-circuits when no Mongo URI was configured', async () => {
    const factory: ReposFactory = vi.fn(async () => fakeRepos());
    const container = containerWith(factory);
    const connector = new GuildDbConnector(container, undefined, 'bot-1', silent);

    await connector.connectAll({
      'g-1': { bot_name: '', guild: fakeGuild('g-1') },
    });

    expect(factory).not.toHaveBeenCalled();
  });
});

describe('GuildDbConnector.isDisabled', () => {
  it('passes through to ConnectionManager.isDisabled', () => {
    const expected = {
      traceId: 't-1',
      error: new DatabaseError({
        code: 'DATABASE_TIMEOUT',
        messageKey: 'errors:db.guild_disabled',
        messageParams: { traceId: 't-1' },
        context: { operation: 'GuildDbConnector.test', guildId: 'g-1' },
      }),
    };
    const cm: ConnectionManager = {
      isDisabled: vi.fn(() => expected),
    } as unknown as ConnectionManager;
    const container = containerWith(undefined, cm);
    const connector = new GuildDbConnector(container, 'mongodb://x', 'bot-1', silent);

    expect(connector.isDisabled('g-1')).toEqual(expected);
  });

  it('returns undefined when no ConnectionManager is bound', () => {
    const container = createContainer();
    const connector = new GuildDbConnector(container, undefined, 'bot-1', silent);
    expect(connector.isDisabled('g-1')).toBeUndefined();
  });
});
