/**
 * Unit coverage for `/traffic` window resolution and chunked,
 * privacy-filtered aggregation. The repo is faked with an in-memory
 * `findByTimestampRange` mirroring the real `[start, end)` semantics so
 * the day-chunk loop and bucket placement are exercised end to end.
 */
import { describe, expect, it } from 'vitest';

import { ok } from '../../../../src/core/result';
import { aggregateTraffic } from '../../../../src/handlers/commands/traffic/aggregation';
import { resolveWindow } from '../../../../src/handlers/commands/traffic-shared/window';
import type { Repos } from '../../../../src/persistence/repositories';
import type { MessageDoc } from '../../../../src/persistence/schemas/message.schema';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

interface DocInput {
  readonly timestamp: number;
  readonly channelId: string;
  readonly userId: string;
  readonly reactions?: readonly {
    readonly name?: string;
    readonly id?: string | null;
    readonly animated?: boolean;
    readonly count?: number;
  }[];
  readonly attachments?: readonly unknown[];
}

const doc = (over: DocInput): MessageDoc =>
  ({
    channelId: over.channelId,
    channelName: `name-${over.channelId}`,
    userId: over.userId,
    userName: `user-${over.userId}`,
    content: '',
    messageId: `m-${over.timestamp}-${over.channelId}-${over.userId}`,
    attachments: over.attachments ?? [],
    reactions: over.reactions ?? [],
    stickers: [],
    timestamp: over.timestamp,
  }) as unknown as MessageDoc;

const fakeRepo = (docs: readonly MessageDoc[]): Pick<Repos, 'message'> =>
  ({
    message: {
      findByTimestampRange: async (start: number, end: number) =>
        ok(docs.filter((d) => d.timestamp >= start && d.timestamp < end)),
    },
  }) as unknown as Pick<Repos, 'message'>;

describe('resolveWindow', () => {
  it('maps 24h to 24 hourly buckets', () => {
    const w = resolveWindow('24h', NOW);
    expect(w.bucket).toBe('hour');
    expect(w.bucketCount).toBe(24);
    expect(w.endMs - w.startMs).toBe(24 * HOUR);
  });

  it('maps 7d and 30d to daily buckets', () => {
    expect(resolveWindow('7d', NOW)).toMatchObject({ bucket: 'day', bucketCount: 7 });
    expect(resolveWindow('30d', NOW)).toMatchObject({ bucket: 'day', bucketCount: 30 });
  });
});

describe('aggregateTraffic', () => {
  it('counts only allowed channels and tallies every dimension', async () => {
    const w = resolveWindow('7d', NOW);
    const docs = [
      doc({
        timestamp: NOW - DAY,
        channelId: 'pub',
        userId: 'a',
        reactions: [{ name: 'thumbsup', count: 2 }],
      }),
      doc({ timestamp: NOW - DAY + HOUR, channelId: 'pub', userId: 'b' }),
      doc({ timestamp: NOW - 2 * DAY, channelId: 'secret', userId: 'a' }), // disallowed
    ];
    const agg = await aggregateTraffic(fakeRepo(docs), w, new Set(['pub']));
    expect(agg.totalMessages).toBe(2);
    expect(agg.perChannel.get('pub')).toBe(2);
    expect(agg.perChannel.has('secret')).toBe(false);
    expect(agg.activeChannels).toBe(1);
    expect(agg.activeUsers).toBe(2);
    expect(agg.topUserCount).toBe(1);
    expect(agg.totalReactions).toBe(2);
    expect(agg.topReaction).toEqual({ name: 'thumbsup', id: null, animated: false, count: 2 });
    expect(agg.busiest?.count).toBe(2);
    expect(agg.quietest?.count).toBe(0);
  });

  it('picks the most-summed reaction and leaves topReaction null when unnamed', async () => {
    const w = resolveWindow('7d', NOW);
    const docs = [
      doc({
        timestamp: NOW - DAY,
        channelId: 'pub',
        userId: 'a',
        reactions: [
          { name: 'fire', count: 5 },
          { name: 'tada', count: 1 },
        ],
      }),
      doc({
        timestamp: NOW - DAY,
        channelId: 'pub',
        userId: 'b',
        reactions: [{ name: 'tada', count: 3 }],
      }),
    ];
    const agg = await aggregateTraffic(fakeRepo(docs), w, new Set(['pub']));
    expect(agg.topReaction).toEqual({ name: 'fire', id: null, animated: false, count: 5 });

    const unnamed = await aggregateTraffic(
      fakeRepo([
        doc({ timestamp: NOW - DAY, channelId: 'pub', userId: 'a', reactions: [{ count: 9 }] }),
      ]),
      w,
      new Set(['pub']),
    );
    expect(unnamed.topReaction).toBeNull();
    expect(unnamed.totalReactions).toBe(9);
  });

  it('places boundary timestamps in the correct bucket', async () => {
    const w = resolveWindow('7d', NOW);
    const docs = [
      doc({ timestamp: w.startMs, channelId: 'pub', userId: 'a' }),
      doc({ timestamp: w.endMs - 1, channelId: 'pub', userId: 'a' }),
    ];
    const agg = await aggregateTraffic(fakeRepo(docs), w, new Set(['pub']));
    expect(agg.buckets).toHaveLength(7);
    expect(agg.buckets[0]?.count).toBe(1);
    expect(agg.buckets[agg.buckets.length - 1]?.count).toBe(1);
  });

  it('returns an all-zero aggregate with no busiest bucket for empty data', async () => {
    const agg = await aggregateTraffic(fakeRepo([]), resolveWindow('24h', NOW), new Set(['pub']));
    expect(agg.totalMessages).toBe(0);
    expect(agg.busiest).toBeNull();
    expect(agg.quietest).toBeNull();
    expect(agg.topReaction).toBeNull();
    expect(agg.topUserCount).toBe(0);
    expect(agg.activeChannels).toBe(0);
  });

  it('computes the daily average over the window length', async () => {
    const w = resolveWindow('7d', NOW);
    const docs = Array.from({ length: 14 }, (_, i) =>
      doc({ timestamp: NOW - DAY, channelId: 'pub', userId: `u${i % 2}` }),
    );
    const agg = await aggregateTraffic(fakeRepo(docs), w, new Set(['pub']));
    expect(agg.totalMessages).toBe(14);
    expect(agg.dailyAverage).toBeCloseTo(2);
  });

  it('re-throws a repo error to the caller', async () => {
    const failing = {
      message: { findByTimestampRange: async () => ({ ok: false, error: new Error('boom') }) },
    } as unknown as Pick<Repos, 'message'>;
    await expect(aggregateTraffic(failing, resolveWindow('24h', NOW), new Set())).rejects.toThrow(
      'boom',
    );
  });
});
