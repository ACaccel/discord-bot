/**
 * Chunked, privacy-filtered aggregation focused on ONE user for
 * `/traffic_me`. Within the invoker's visible channels it accumulates
 * the focus user's per-channel / per-time-bucket counts, plus a global
 * per-user tally so the user's share of visible traffic and their rank
 * among active users can be derived. Day-sized chunks bound heap use
 * (mirrors `/traffic`'s aggregation).
 */
import type { MessageDoc } from '../../../persistence/schemas/message.schema';
import type { Repos } from '../../../persistence/repositories';

import type { BucketCount, BucketGranularity, TimeWindow } from '../traffic-shared/types';
import { DAY_MS } from '../traffic-shared/window';

export interface UserTrafficAggregate {
  readonly userTotal: number;
  readonly guildTotal: number;
  readonly perChannel: ReadonlyMap<string, number>;
  readonly channelNames: ReadonlyMap<string, string>;
  readonly buckets: readonly BucketCount[];
  readonly bucket: BucketGranularity;
  readonly busiest: BucketCount | null;
  readonly dailyAverage: number;
  readonly rank: number;
  readonly activeUsers: number;
  readonly windowDays: number;
}

interface Accumulator {
  userTotal: number;
  readonly perUserGlobal: Map<string, number>;
  readonly perChannel: Map<string, number>;
  readonly channelNames: Map<string, string>;
  readonly buckets: BucketCount[];
}

const initAccumulator = (window: TimeWindow): Accumulator => {
  const buckets: BucketCount[] = [];
  for (let i = 0; i < window.bucketCount; i++) {
    buckets.push({ startMs: window.startMs + i * window.bucketMs, count: 0 });
  }
  return {
    userTotal: 0,
    perUserGlobal: new Map(),
    perChannel: new Map(),
    channelNames: new Map(),
    buckets,
  };
};

const bump = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const accumulateChunk = (
  messages: readonly MessageDoc[],
  acc: Accumulator,
  allowed: ReadonlySet<string>,
  window: TimeWindow,
  userId: string,
): void => {
  for (const m of messages) {
    if (!allowed.has(m.channelId)) continue;
    bump(acc.perUserGlobal, m.userId); // every visible author — for total / rank
    if (m.userId !== userId) continue;
    acc.userTotal++;
    bump(acc.perChannel, m.channelId);
    acc.channelNames.set(m.channelId, m.channelName);
    const idx = Math.floor((m.timestamp - window.startMs) / window.bucketMs);
    if (idx >= 0 && idx < acc.buckets.length) {
      const bucket = acc.buckets[idx];
      if (bucket) bucket.count++;
    }
  }
};

const finalize = (acc: Accumulator, window: TimeWindow, userId: string): UserTrafficAggregate => {
  let busiest: BucketCount | null = null;
  for (const bucket of acc.buckets) {
    if (busiest === null || bucket.count > busiest.count) busiest = bucket;
  }
  let guildTotal = 0;
  let rankedAbove = 0;
  const mine = acc.perUserGlobal.get(userId) ?? 0;
  for (const count of acc.perUserGlobal.values()) {
    guildTotal += count;
    if (count > mine) rankedAbove++;
  }
  const windowDays = Math.max(1, (window.endMs - window.startMs) / DAY_MS);
  return {
    userTotal: acc.userTotal,
    guildTotal,
    perChannel: acc.perChannel,
    channelNames: acc.channelNames,
    buckets: acc.buckets,
    bucket: window.bucket,
    busiest: busiest !== null && busiest.count > 0 ? busiest : null,
    dailyAverage: acc.userTotal / windowDays,
    rank: acc.userTotal > 0 ? rankedAbove + 1 : 0,
    activeUsers: acc.perUserGlobal.size,
    windowDays,
  };
};

export const aggregateUserTraffic = async (
  repos: Pick<Repos, 'message'>,
  window: TimeWindow,
  allowed: ReadonlySet<string>,
  userId: string,
): Promise<UserTrafficAggregate> => {
  const acc = initAccumulator(window);
  for (let chunkStart = window.startMs; chunkStart < window.endMs; chunkStart += DAY_MS) {
    const chunkEnd = Math.min(chunkStart + DAY_MS, window.endMs);
    const result = await repos.message.findByTimestampRange(chunkStart, chunkEnd);
    if (!result.ok) throw result.error;
    accumulateChunk(result.value, acc, allowed, window, userId);
  }
  return finalize(acc, window, userId);
};
