/**
 * Integration coverage for the `/traffic` privacy invariant across the
 * real persistence path. Seeds messages in a public and a private
 * channel into a fresh mongodb-memory-server database, then runs the
 * production `aggregateTraffic` with an `allowed` set restricted to the
 * public channel (the shape the visibility filter yields — its gate
 * logic is unit-tested separately). Asserts the private channel never
 * reaches the aggregate.
 */
import { describe, expect, it } from 'vitest';

import { asGuildId } from '../../../src/core/ids';
import { unwrap } from '../../../src/core/result';
import { aggregateTraffic } from '../../../src/handlers/commands/traffic/aggregation';
import { resolveWindow } from '../../../src/handlers/commands/traffic-shared/window';
import { StaticConnectionManager } from '../../../src/infra/mongo/connection-manager';
import { MongoMessageRepo } from '../../../src/persistence/repositories/message.repo';
import type { MessageDoc } from '../../../src/persistence/schemas/message.schema';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');
const DAY = 86_400_000;

const buildDoc = (
  over: Partial<MessageDoc> & { messageId: string; channelId: string; timestamp: number },
): MessageDoc =>
  ({
    channelName: `name-${over.channelId}`,
    content: '',
    userId: 'u1',
    userName: 'tester',
    attachments: [],
    reactions: [],
    stickers: [],
    ...over,
  }) as MessageDoc;

describe('traffic aggregation (integration)', () => {
  it('excludes private-channel messages from the aggregate end to end', async () => {
    await withFreshConnection(async (connection) => {
      const manager = new StaticConnectionManager(connection);
      const guildConn = await manager.getConnection(guildId);
      const repo = new MongoMessageRepo(guildConn);
      const now = Date.now();

      unwrap(
        await repo.insertManyIgnoringDuplicates([
          buildDoc({ messageId: 'p1', channelId: 'pub', timestamp: now - DAY }),
          buildDoc({
            messageId: 'p2',
            channelId: 'pub',
            timestamp: now - 2 * DAY,
            userId: 'u2',
            userName: 'two',
          }),
          buildDoc({ messageId: 's1', channelId: 'secret', timestamp: now - DAY }),
          buildDoc({ messageId: 's2', channelId: 'secret', timestamp: now - 3 * DAY }),
        ]),
      );

      const window = resolveWindow('7d', now);
      const allowed = new Set(['pub']);
      const agg = await aggregateTraffic({ message: repo }, window, allowed);

      expect(agg.totalMessages).toBe(2);
      expect(agg.perChannel.get('pub')).toBe(2);
      expect(agg.perChannel.has('secret')).toBe(false);
      expect(agg.activeUsers).toBe(2);
    });
  });
});
