/**
 * Integration coverage for `MongoReplyRepo`. One case per public method
 * plus the "absent" branches for `findById` (unknown id → undefined) and
 * `deleteById` (no document removed → false) — both observable contract
 * returns that would silently regress without an assertion.
 */
import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { StaticConnectionManager } from '../../../src/infra/mongo/connection-manager';
import { MongoReplyRepo } from '../../../src/persistence/repositories/reply.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');

describe('MongoReplyRepo (integration)', () => {
  it('create persists a pair and returns the stored doc', async () => {
    await withFreshConnection(async (connection) => {
      const repo = new MongoReplyRepo(
        await new StaticConnectionManager(connection).getConnection(guildId),
      );
      const doc = await repo.create('hello', 'world');
      expect(doc.input).toBe('hello');
      expect(doc.reply).toBe('world');
    });
  });

  it('findExactPair returns matching pairs only', async () => {
    await withFreshConnection(async (connection) => {
      const repo = new MongoReplyRepo(
        await new StaticConnectionManager(connection).getConnection(guildId),
      );
      await repo.create('hi', 'there');
      await repo.create('hi', 'world'); // same input, different reply
      const exact = await repo.findExactPair('hi', 'there');
      expect(exact).toHaveLength(1);
      expect(exact[0]?.reply).toBe('there');
    });
  });

  it('findByInput returns every reply registered for one input', async () => {
    await withFreshConnection(async (connection) => {
      const repo = new MongoReplyRepo(
        await new StaticConnectionManager(connection).getConnection(guildId),
      );
      await repo.create('q', 'a1');
      await repo.create('q', 'a2');
      await repo.create('other', 'noise');
      const got = await repo.findByInput('q');
      expect(got.map((d) => d.reply).sort()).toEqual(['a1', 'a2']);
    });
  });

  it('findById returns the stored doc when present', async () => {
    await withFreshConnection(async (connection) => {
      const repo = new MongoReplyRepo(
        await new StaticConnectionManager(connection).getConnection(guildId),
      );
      const created = await repo.create('k', 'v');
      const found = await repo.findById(created._id.toString());
      expect(found?.reply).toBe('v');
    });
  });

  it('findById returns undefined for an unknown id', async () => {
    await withFreshConnection(async (connection) => {
      const repo = new MongoReplyRepo(
        await new StaticConnectionManager(connection).getConnection(guildId),
      );
      // Valid-shape ObjectId that has not been persisted.
      expect(await repo.findById('507f1f77bcf86cd799439011')).toBeUndefined();
    });
  });

  it('deleteById removes a stored doc and returns true', async () => {
    await withFreshConnection(async (connection) => {
      const repo = new MongoReplyRepo(
        await new StaticConnectionManager(connection).getConnection(guildId),
      );
      const created = await repo.create('k', 'v');
      expect(await repo.deleteById(created._id.toString())).toBe(true);
      expect(await repo.findById(created._id.toString())).toBeUndefined();
    });
  });

  it('deleteById returns false when nothing was removed', async () => {
    await withFreshConnection(async (connection) => {
      const repo = new MongoReplyRepo(
        await new StaticConnectionManager(connection).getConnection(guildId),
      );
      expect(await repo.deleteById('507f1f77bcf86cd799439011')).toBe(false);
    });
  });
});
