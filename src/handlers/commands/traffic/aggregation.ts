/**
 * Chunked, privacy-filtered aggregation for `/traffic`. Messages are
 * folded into one mutable accumulator (mirroring `emoji_frequency`'s
 * heap discipline); the window layout and the day-sized fetch loop come
 * from `../traffic-shared/aggregation-common`, window resolution from
 * `../traffic-shared/window`.
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
} from '../traffic-shared/aggregation-common';
import type { BucketCount, BucketGranularity, TimeWindow } from '../traffic-shared/types';

import { tallyReactions, topReactionOf, type ReactionTally, type TopReaction } from './reactions';

/**
 * Privacy-filtered traffic statistics over a window. Every counter is
 * derived only from messages in channels the invoker may see (see
 * `../traffic-shared/visibility-filter`), so the whole aggregate is safe
 * to render.
 */
export interface TrafficAggregate {
  readonly totalMessages: number;
  readonly perChannel: ReadonlyMap<string, number>;
  readonly channelNames: ReadonlyMap<string, string>;
  readonly perUser: ReadonlyMap<string, number>;
  readonly userNames: ReadonlyMap<string, string>;
  readonly buckets: readonly BucketCount[];
  readonly bucket: BucketGranularity;
  readonly totalReactions: number;
  readonly topReaction: TopReaction | null;
  readonly activeChannels: number;
  readonly activeUsers: number;
  readonly topUserCount: number;
  readonly dailyAverage: number;
  readonly busiest: BucketCount | null;
  readonly quietest: BucketCount | null;
  readonly windowDays: number;
}

interface Accumulator {
  totalMessages: number;
  totalReactions: number;
  readonly perChannel: Map<string, number>;
  readonly channelNames: Map<string, string>;
  readonly perUser: Map<string, number>;
  readonly userNames: Map<string, string>;
  readonly reactionTallies: Map<string, ReactionTally>;
  readonly buckets: BucketCount[];
}

const initAccumulator = (window: TimeWindow): Accumulator => ({
  totalMessages: 0,
  totalReactions: 0,
  perChannel: new Map(),
  channelNames: new Map(),
  perUser: new Map(),
  userNames: new Map(),
  reactionTallies: new Map(),
  buckets: createBuckets(window),
});

/**
 * Fold a chunk of messages into the accumulator. The privacy filter is
 * applied FIRST — a message in a disallowed channel is skipped before
 * any counter is touched. Mutates `acc` in place.
 */
const accumulateChunk = (
  messages: readonly MessageDoc[],
  acc: Accumulator,
  allowed: ReadonlySet<string>,
  window: TimeWindow,
): void => {
  for (const m of messages) {
    if (!allowed.has(m.channelId)) continue;
    acc.totalMessages++;
    bump(acc.perChannel, m.channelId);
    acc.channelNames.set(m.channelId, m.channelName);
    bump(acc.perUser, m.userId);
    acc.userNames.set(m.userId, m.userName);
    bumpBucket(acc.buckets, window, m.timestamp);
    // Sum per-emoji so finalize can surface the window's top reaction.
    acc.totalReactions += tallyReactions(m.reactions ?? [], acc.reactionTallies);
  }
};

/** Largest single value across a counter map (0 for an empty map). */
const maxCount = (counts: ReadonlyMap<string, number>): number => {
  let max = 0;
  for (const value of counts.values()) if (value > max) max = value;
  return max;
};

const finalize = (acc: Accumulator, window: TimeWindow): TrafficAggregate => {
  const { busiest, quietest } = bucketExtremes(acc.buckets);
  const hasActivity = acc.totalMessages > 0;
  const windowDays = windowDaysOf(window);
  return {
    totalMessages: acc.totalMessages,
    perChannel: acc.perChannel,
    channelNames: acc.channelNames,
    perUser: acc.perUser,
    userNames: acc.userNames,
    buckets: acc.buckets,
    bucket: window.bucket,
    totalReactions: acc.totalReactions,
    topReaction: topReactionOf(acc.reactionTallies),
    activeChannels: acc.perChannel.size,
    activeUsers: acc.perUser.size,
    topUserCount: maxCount(acc.perUser),
    dailyAverage: acc.totalMessages / windowDays,
    busiest: hasActivity ? busiest : null,
    quietest: hasActivity ? quietest : null,
    windowDays,
  };
};

/**
 * Fetch the window's messages in day-sized chunks and fold them into a
 * privacy-filtered aggregate.
 */
export const aggregateTraffic = async (
  repos: Pick<Repos, 'message'>,
  window: TimeWindow,
  allowed: ReadonlySet<string>,
): Promise<TrafficAggregate> => {
  const acc = initAccumulator(window);
  await forEachDayChunk(repos, window, (messages) =>
    accumulateChunk(messages, acc, allowed, window),
  );
  return finalize(acc, window);
};
