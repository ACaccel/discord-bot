/**
 * Chunked, privacy-filtered aggregation focused on ONE user, shared by
 * `/traffic_me` (focus = the invoker) and `/traffic_user` (focus = a
 * specified target). Within the invoker's visible channels (`allowed`,
 * built from the invoker's clearance — never the focus user's) it
 * accumulates the focus user's per-channel / per-time-bucket counts, plus
 * a global per-user tally so the user's share of visible traffic and
 * their rank among active users can be derived. The window layout and
 * the day-sized fetch loop come from `./aggregation-common`.
 */
import type { MessageDoc } from '../../../persistence/schemas/message.schema';
import type { Repos } from '../../../persistence/repositories';

import {
  bucketExtremes,
  bump,
  bumpBucket,
  createBuckets,
  forEachDayChunk,
  windowDaysOf,
} from './aggregation-common';
import type { BucketCount, BucketGranularity, TimeWindow } from './types';

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

const initAccumulator = (window: TimeWindow): Accumulator => ({
  userTotal: 0,
  perUserGlobal: new Map(),
  perChannel: new Map(),
  channelNames: new Map(),
  buckets: createBuckets(window),
});

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
    bumpBucket(acc.buckets, window, m.timestamp);
  }
};

const finalize = (acc: Accumulator, window: TimeWindow, userId: string): UserTrafficAggregate => {
  const { busiest } = bucketExtremes(acc.buckets);
  let guildTotal = 0;
  let rankedAbove = 0;
  const mine = acc.perUserGlobal.get(userId) ?? 0;
  for (const count of acc.perUserGlobal.values()) {
    guildTotal += count;
    if (count > mine) rankedAbove++;
  }
  const windowDays = windowDaysOf(window);
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
  await forEachDayChunk(repos, window, (messages) =>
    accumulateChunk(messages, acc, allowed, window, userId),
  );
  return finalize(acc, window, userId);
};
