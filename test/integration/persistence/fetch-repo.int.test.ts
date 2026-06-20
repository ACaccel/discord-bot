import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { DatabaseError } from '../../../src/core/errors';
import { isErr, unwrap } from '../../../src/core/result';
import {
  StaticConnectionManager,
  buildGuildMongoUri,
} from '../../../src/infra/mongo/connection-manager';
import { MongoFetchRepo } from '../../../src/persistence/repositories/fetch.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');

const buildRepo = async (manager: StaticConnectionManager): Promise<MongoFetchRepo> =>
  new MongoFetchRepo(await manager.getConnection(guildId));

describe('MongoFetchRepo (integration)', () => {
  it('listChannelIds returns the empty array on a fresh database', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.listChannelIds())).toEqual([]);
    });
  });

  it('create persists a marker that findByChannelId can retrieve', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      const created = unwrap(await repo.create('general', 'c1', 'm0'));
      expect(created.channelID).toBe('c1');
      expect(unwrap(await repo.findByChannelId('c1'))?.lastMessageID).toBe('m0');
    });
  });

  it('listChannelIds returns every channel id after multiple creates', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.create('a', 'c1', ''));
      unwrap(await repo.create('b', 'c2', ''));
      const ids = unwrap(await repo.listChannelIds());
      expect([...ids].sort()).toEqual(['c1', 'c2']);
    });
  });

  it('findByChannelId returns ok(undefined) for an unknown channel id', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.findByChannelId('missing'))).toBeUndefined();
    });
  });

  it('setLastMessageID advances the cursor and reports the match', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.create('a', 'c1', 'm0'));
      expect(unwrap(await repo.setLastMessageID('c1', 'm9'))).toBe(true);
      expect(unwrap(await repo.findByChannelId('c1'))?.lastMessageID).toBe('m9');
    });
  });

  it('setLastMessageID returns false when no document matches', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.setLastMessageID('missing', 'm9'))).toBe(false);
    });
  });

  it('upsertLastMessageID resolves to ok(undefined) and writes the marker', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.upsertLastMessageID('a', 'c1', 'm5'))).toBeUndefined();
      expect(unwrap(await repo.findByChannelId('c1'))?.lastMessageID).toBe('m5');
    });
  });

  it('deleteByChannelId removes the marker and returns true', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.create('a', 'c1', ''));
      expect(unwrap(await repo.deleteByChannelId('c1'))).toBe(true);
      expect(unwrap(await repo.findByChannelId('c1'))).toBeUndefined();
    });
  });

  it('deleteByChannelId returns false when the marker is absent', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.deleteByChannelId('missing'))).toBe(false);
    });
  });

  // A genuine DB failure resolves to `err(DatabaseError)`.
  it('listChannelIds resolves to err(DatabaseError) when the connection is closed', async () => {
    const baseUri = (() => {
      const uri = process.env.INTEGRATION_MONGO_URI;
      if (uri === undefined) throw new Error('INTEGRATION_MONGO_URI not set');
      return uri.replace(/[^/]*$/, '');
    })();
    const connection = await mongoose
      .createConnection(buildGuildMongoUri(baseUri, guildId))
      .asPromise();
    const repo = new MongoFetchRepo(
      await new StaticConnectionManager(connection).getConnection(guildId),
    );
    await connection.close();

    const result = await repo.listChannelIds();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(DatabaseError);
      expect(result.error.context.operation).toBe('MongoFetchRepo.listChannelIds');
    }
  });
});
