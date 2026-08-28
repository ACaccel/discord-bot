import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { isOk, unwrap } from '../../../src/core/result';
import {
  StaticConnectionManager,
  buildGuildMongoUri,
} from '../../../src/infra/mongo/connection-manager';
import { MongoXFeedCursorRepo } from '../../../src/persistence/repositories/x-feed-cursor.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');

const buildRepo = async (m: StaticConnectionManager): Promise<MongoXFeedCursorRepo> =>
  new MongoXFeedCursorRepo(await m.getConnection(guildId));

/**
 * A real 64-bit X post id. It exceeds `Number.MAX_SAFE_INTEGER`, so these
 * tests double as proof that the String column round-trips it intact —
 * a Number column would corrupt it and silently break de-duplication.
 */
const BIG_ID = '2092744659667673582';

describe('MongoXFeedCursorRepo (integration)', () => {
  it('findByHandle returns ok(undefined) before the first pass', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.findByHandle('nobody'))).toBeUndefined();
    });
  });

  it('upsert creates the cursor when absent', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.upsert('acct', BIG_ID, 1_787_784_182));

      const found = unwrap(await repo.findByHandle('acct'));
      expect(found?.last_seen_id).toBe(BIG_ID);
      expect(found?.last_seen_timestamp).toBe(1_787_784_182);
    });
  });

  it('round-trips a 64-bit post id without precision loss', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.upsert('acct', BIG_ID, 1));

      const found = unwrap(await repo.findByHandle('acct'));
      expect(found?.last_seen_id).toBe(BIG_ID);
      expect(BigInt(found?.last_seen_id ?? '0')).toBe(BigInt(BIG_ID));
    });
  });

  it('upsert advances an existing cursor in place rather than inserting a second row', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.upsert('acct', '100', 10));
      unwrap(await repo.upsert('acct', '200', 20));

      const found = unwrap(await repo.findByHandle('acct'));
      expect(found?.last_seen_id).toBe('200');
      expect(found?.last_seen_timestamp).toBe(20);
      // The unique index on `handle` would reject a duplicate insert, so a
      // successful second upsert proves the update path was taken.
      const count = await connection.collection('xfeedcursors').countDocuments({ handle: 'acct' });
      expect(count).toBe(1);
    });
  });

  it('keeps one cursor per handle', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.upsert('first', '100', 10));
      unwrap(await repo.upsert('second', '200', 20));

      expect(unwrap(await repo.findByHandle('first'))?.last_seen_id).toBe('100');
      expect(unwrap(await repo.findByHandle('second'))?.last_seen_id).toBe('200');
    });
  });

  it('reports a driver failure on the Err rail instead of throwing', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      // A BSON-incompatible value the driver refuses to serialise.
      const result = await repo.upsert('acct', BIG_ID, Number.NaN);
      expect(isOk(result)).toBe(false);
    });
  });
});

describe('MongoXFeedCursorRepo — reconciliation surface (integration)', () => {
  it('listHandles returns every stored handle', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.upsert('first', '100', 10));
      unwrap(await repo.upsert('second', '200', 20));

      expect([...unwrap(await repo.listHandles())].sort()).toEqual(['first', 'second']);
    });
  });

  it('listHandles returns an empty list for a fresh guild', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.listHandles())).toEqual([]);
    });
  });

  it('deleteByHandle removes exactly that cursor and reports true', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.upsert('gone', '100', 10));
      unwrap(await repo.upsert('kept', '200', 20));

      expect(unwrap(await repo.deleteByHandle('gone'))).toBe(true);
      expect(unwrap(await repo.findByHandle('gone'))).toBeUndefined();
      expect(unwrap(await repo.findByHandle('kept'))?.last_seen_id).toBe('200');
    });
  });

  it('deleteByHandle on an absent handle reports false rather than failing', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.deleteByHandle('never-stored'))).toBe(false);
    });
  });
});

describe('buildGuildMongoUri', () => {
  it('is the shared helper the connection manager uses', () => {
    expect(buildGuildMongoUri('mongodb://host:27017/', guildId)).toContain(guildId);
  });
});
