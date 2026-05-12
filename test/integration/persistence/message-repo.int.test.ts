/**
 * Reference integration test for the persistence layer.
 *
 * Demonstrates the contract every Phase 2 PR-B repo test will follow:
 *   1. Open a fresh mongoose connection against the shared memory server.
 *   2. Wrap it in a `StaticConnectionManager` so the production
 *      `MongoMessageRepo` runs against the same `GuildConnection`
 *      shape it uses in production.
 *   3. Exercise CRUD methods, asserting both happy-path and the
 *      duplicate-key tolerance contract.
 *   4. The `withFreshConnection` helper drops the database afterwards
 *      so each `it()` is fully isolated.
 */
import { describe, expect, it } from 'vitest';
import { asChannelId, asGuildId } from '../../../src/core/ids';
import { StaticConnectionManager } from '../../../src/infra/mongo/connection-manager';
import { MongoMessageRepo } from '../../../src/persistence/repositories/message.repo';
import type { MessageDoc } from '../../../src/persistence/schemas/message.schema';
import { withFreshConnection } from '../helpers/mongo';

const channelId = asChannelId('111111111111111111');
const otherChannelId = asChannelId('222222222222222222');
const guildId = asGuildId('999999999999999999');

const buildMessageDoc = (overrides: Partial<MessageDoc> & { messageId: string }): MessageDoc =>
  ({
    channelId: String(channelId),
    channelName: 'general',
    content: 'hello',
    userId: 'user-1',
    userName: 'tester',
    timestamp: Date.now(),
    attachments: [],
    reactions: [],
    stickers: [],
    ...overrides,
  }) as MessageDoc;

describe('MongoMessageRepo (integration)', () => {
  it('countAll returns 0 on an empty collection', async () => {
    await withFreshConnection(async (connection) => {
      const manager = new StaticConnectionManager(connection);
      const guildConn = await manager.getConnection(guildId);
      const repo = new MongoMessageRepo(guildConn);
      expect(await repo.countAll()).toBe(0);
    });
  });

  it('insertManyIgnoringDuplicates writes new docs and reports the count', async () => {
    await withFreshConnection(async (connection) => {
      const manager = new StaticConnectionManager(connection);
      const guildConn = await manager.getConnection(guildId);
      const repo = new MongoMessageRepo(guildConn);

      const result = await repo.insertManyIgnoringDuplicates([
        buildMessageDoc({ messageId: 'm1' }),
        buildMessageDoc({ messageId: 'm2' }),
        buildMessageDoc({ messageId: 'm3' }),
      ]);

      expect(result).toEqual({ inserted: 3, duplicates: 0 });
      expect(await repo.countAll()).toBe(3);
    });
  });

  it('insertManyIgnoringDuplicates tolerates duplicate messageId without aborting the batch', async () => {
    await withFreshConnection(async (connection) => {
      const manager = new StaticConnectionManager(connection);
      const guildConn = await manager.getConnection(guildId);
      const repo = new MongoMessageRepo(guildConn);

      await repo.insertManyIgnoringDuplicates([buildMessageDoc({ messageId: 'm1' })]);

      const result = await repo.insertManyIgnoringDuplicates([
        buildMessageDoc({ messageId: 'm1' }), // duplicate
        buildMessageDoc({ messageId: 'm2' }),
        buildMessageDoc({ messageId: 'm3' }),
      ]);

      expect(result.inserted).toBe(2);
      expect(result.duplicates).toBe(1);
      expect(await repo.countAll()).toBe(3);
    });
  });

  it('findRecentByChannel returns newest-first, scoped to channelId, capped by limit', async () => {
    await withFreshConnection(async (connection) => {
      const manager = new StaticConnectionManager(connection);
      const guildConn = await manager.getConnection(guildId);
      const repo = new MongoMessageRepo(guildConn);

      await repo.insertManyIgnoringDuplicates([
        buildMessageDoc({ messageId: 'a', timestamp: 100 }),
        buildMessageDoc({ messageId: 'b', timestamp: 200 }),
        buildMessageDoc({ messageId: 'c', timestamp: 300 }),
        buildMessageDoc({
          messageId: 'd',
          timestamp: 400,
          channelId: String(otherChannelId),
        }),
      ]);

      const recent = await repo.findRecentByChannel(channelId, 2);
      expect(recent.map((d) => d.messageId)).toEqual(['c', 'b']);
    });
  });

  it('findRecentByChannel rejects a non-positive limit', async () => {
    await withFreshConnection(async (connection) => {
      const manager = new StaticConnectionManager(connection);
      const guildConn = await manager.getConnection(guildId);
      const repo = new MongoMessageRepo(guildConn);
      await expect(repo.findRecentByChannel(channelId, 0)).rejects.toThrow(TypeError);
      await expect(repo.findRecentByChannel(channelId, -1)).rejects.toThrow(TypeError);
      await expect(repo.findRecentByChannel(channelId, 1.5)).rejects.toThrow(TypeError);
    });
  });

  it('findRecentByChannel returns every match when limit ≥ data size', async () => {
    await withFreshConnection(async (connection) => {
      const manager = new StaticConnectionManager(connection);
      const guildConn = await manager.getConnection(guildId);
      const repo = new MongoMessageRepo(guildConn);

      await repo.insertManyIgnoringDuplicates([
        buildMessageDoc({ messageId: 'a', timestamp: 100 }),
        buildMessageDoc({ messageId: 'b', timestamp: 200 }),
      ]);
      const all = await repo.findRecentByChannel(channelId, 100);
      expect(all.map((d) => d.messageId)).toEqual(['b', 'a']);
    });
  });

  it('findByMessageId returns undefined when the message is not stored', async () => {
    await withFreshConnection(async (connection) => {
      const manager = new StaticConnectionManager(connection);
      const guildConn = await manager.getConnection(guildId);
      const repo = new MongoMessageRepo(guildConn);
      expect(await repo.findByMessageId('does-not-exist')).toBeUndefined();
    });
  });

  it('findByMessageId returns the stored doc when present', async () => {
    await withFreshConnection(async (connection) => {
      const manager = new StaticConnectionManager(connection);
      const guildConn = await manager.getConnection(guildId);
      const repo = new MongoMessageRepo(guildConn);
      await repo.insertManyIgnoringDuplicates([
        buildMessageDoc({ messageId: 'unique-id', content: 'find me' }),
      ]);
      const doc = await repo.findByMessageId('unique-id');
      expect(doc?.content).toBe('find me');
    });
  });
});
