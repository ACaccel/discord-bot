import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { StaticConnectionManager } from '../../../src/infra/mongo/connection-manager';
import { MongoFetchRepo } from '../../../src/persistence/repositories/fetch.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');

const buildRepo = async (manager: StaticConnectionManager): Promise<MongoFetchRepo> =>
  new MongoFetchRepo(await manager.getConnection(guildId));

describe('MongoFetchRepo (integration)', () => {
  it('listChannelIds returns the empty array on a fresh database', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.listChannelIds()).toEqual([]);
    });
  });

  it('create persists a marker that findByChannelId can retrieve', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      const created = await repo.create('general', 'c1', 'm0');
      expect(created.channelID).toBe('c1');
      expect((await repo.findByChannelId('c1'))?.lastMessageID).toBe('m0');
    });
  });

  it('listChannelIds returns every channel id after multiple creates', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create('a', 'c1', '');
      await repo.create('b', 'c2', '');
      const ids = await repo.listChannelIds();
      expect([...ids].sort()).toEqual(['c1', 'c2']);
    });
  });

  it('findByChannelId returns undefined for an unknown channel id', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.findByChannelId('missing')).toBeUndefined();
    });
  });

  it('setLastMessageID advances the cursor and reports the match', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create('a', 'c1', 'm0');
      expect(await repo.setLastMessageID('c1', 'm9')).toBe(true);
      expect((await repo.findByChannelId('c1'))?.lastMessageID).toBe('m9');
    });
  });

  it('setLastMessageID returns false when no document matches', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.setLastMessageID('missing', 'm9')).toBe(false);
    });
  });

  it('deleteByChannelId removes the marker and returns true', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create('a', 'c1', '');
      expect(await repo.deleteByChannelId('c1')).toBe(true);
      expect(await repo.findByChannelId('c1')).toBeUndefined();
    });
  });

  it('deleteByChannelId returns false when the marker is absent', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.deleteByChannelId('missing')).toBe(false);
    });
  });
});
