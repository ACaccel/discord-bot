/**
 * Unit coverage for the shared per-user aggregation (`/traffic_me`,
 * `/traffic_user`). Confirms the focus user's own counts (per-channel /
 * busiest) exclude disallowed channels and other users, while the guild
 * total / active-user count / rank are derived from every visible author.
 * The `allowed` set is the invoker's visible channels, so the same logic
 * powers `/traffic_user` (focus = target, allowed = invoker's view).
 */
import { describe, expect, it } from 'vitest';

import { ok } from '../../../../src/core/result';
import { aggregateUserTraffic } from '../../../../src/handlers/commands/traffic-shared/aggregation-user';
import { resolveWindow } from '../../../../src/handlers/commands/traffic-shared/window';
import type { Repos } from '../../../../src/persistence/repositories';
import type { MessageDoc } from '../../../../src/persistence/schemas/message.schema';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

interface DocInput {
  readonly timestamp: number;
  readonly channelId: string;
  readonly userId: string;
}

const doc = (o: DocInput): MessageDoc =>
  ({
    channelId: o.channelId,
    channelName: `name-${o.channelId}`,
    userId: o.userId,
    userName: `user-${o.userId}`,
    content: '',
    messageId: `m-${o.timestamp}-${o.channelId}-${o.userId}`,
    attachments: [],
    reactions: [],
    stickers: [],
    timestamp: o.timestamp,
  }) as unknown as MessageDoc;

const fakeRepo = (docs: readonly MessageDoc[]): Pick<Repos, 'message'> =>
  ({
    message: {
      findByTimestampRange: async (start: number, end: number) =>
        ok(docs.filter((d) => d.timestamp >= start && d.timestamp < end)),
    },
  }) as unknown as Pick<Repos, 'message'>;

const window = resolveWindow('7d', NOW);
const docs = [
  doc({ timestamp: NOW - DAY, channelId: 'pub', userId: 'me' }),
  doc({ timestamp: NOW - DAY, channelId: 'pub', userId: 'me' }),
  doc({ timestamp: NOW - 2 * DAY, channelId: 'team', userId: 'me' }),
  doc({ timestamp: NOW - DAY, channelId: 'pub', userId: 'other1' }),
  doc({ timestamp: NOW - DAY, channelId: 'pub', userId: 'other1' }),
  doc({ timestamp: NOW - DAY, channelId: 'pub', userId: 'other1' }),
  doc({ timestamp: NOW - DAY, channelId: 'pub', userId: 'other2' }),
  doc({ timestamp: NOW - DAY, channelId: 'secret', userId: 'me' }), // disallowed
];
const allowed = new Set(['pub', 'team']);

describe('aggregateUserTraffic', () => {
  it('counts only the focus user across allowed channels', async () => {
    const agg = await aggregateUserTraffic(fakeRepo(docs), window, allowed, 'me');
    expect(agg.userTotal).toBe(3); // 2 pub + 1 team; secret excluded
    expect(agg.perChannel.get('pub')).toBe(2);
    expect(agg.perChannel.get('team')).toBe(1);
    expect(agg.perChannel.has('secret')).toBe(false);
    expect(agg.busiest?.count).toBe(2); // both pub messages share one day bucket
  });

  it('derives guild total, active users, and rank from every visible author', async () => {
    const agg = await aggregateUserTraffic(fakeRepo(docs), window, allowed, 'me');
    expect(agg.guildTotal).toBe(7); // me 3 + other1 3 + other2 1 (secret excluded)
    expect(agg.activeUsers).toBe(3);
    expect(agg.rank).toBe(1); // me(3) tied with other1(3): none strictly above
  });

  it('returns userTotal 0 and rank 0 for a user with no visible activity', async () => {
    const agg = await aggregateUserTraffic(fakeRepo(docs), window, allowed, 'ghost');
    expect(agg.userTotal).toBe(0);
    expect(agg.rank).toBe(0);
    expect(agg.guildTotal).toBe(7);
  });
});
