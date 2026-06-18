/**
 * Chunked, privacy-filtered aggregation for `/traffic`. Messages are
 * fetched a day at a time and folded into one mutable accumulator
 * (mirroring `emoji_frequency`'s heap discipline) so a long window never
 * holds more than a day of documents at once. Window resolution lives in
 * `../traffic-shared/window`.
 */
import type { MessageDoc } from '../../../persistence/schemas/message.schema';
import type { Repos } from '../../../persistence/repositories';

import { DAY_MS } from '../traffic-shared/window';

import { tallyReactions, topReactionOf, type ReactionTally } from './reactions';
import type { BucketCount, TimeWindow, TrafficAggregate } from './types';

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

const initAccumulator = (window: TimeWindow): Accumulator => {
  const buckets: BucketCount[] = [];
  for (let i = 0; i < window.bucketCount; i++) {
    buckets.push({ startMs: window.startMs + i * window.bucketMs, count: 0 });
  }
  return {
    totalMessages: 0,
    totalReactions: 0,
    perChannel: new Map(),
    channelNames: new Map(),
    perUser: new Map(),
    userNames: new Map(),
    reactionTallies: new Map(),
    buckets,
  };
};

const bump = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

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
    const idx = Math.floor((m.timestamp - window.startMs) / window.bucketMs);
    if (idx >= 0 && idx < acc.buckets.length) {
      const bucket = acc.buckets[idx];
      if (bucket) bucket.count++;
    }
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
  // Single pass yields both the peak and the trough bucket; on a tie the
  // earliest bucket wins (mirrors the busiest-bucket convention).
  let busiest: BucketCount | null = null;
  let quietest: BucketCount | null = null;
  for (const bucket of acc.buckets) {
    if (busiest === null || bucket.count > busiest.count) busiest = bucket;
    if (quietest === null || bucket.count < quietest.count) quietest = bucket;
  }
  const hasActivity = acc.totalMessages > 0;
  const windowDays = Math.max(1, (window.endMs - window.startMs) / DAY_MS);
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
 * privacy-filtered aggregate. A repo error is re-thrown to the handler
 * boundary (`replyForError`).
 */
export const aggregateTraffic = async (
  repos: Pick<Repos, 'message'>,
  window: TimeWindow,
  allowed: ReadonlySet<string>,
): Promise<TrafficAggregate> => {
  const acc = initAccumulator(window);
  for (let chunkStart = window.startMs; chunkStart < window.endMs; chunkStart += DAY_MS) {
    const chunkEnd = Math.min(chunkStart + DAY_MS, window.endMs);
    const result = await repos.message.findByTimestampRange(chunkStart, chunkEnd);
    if (!result.ok) throw result.error;
    accumulateChunk(result.value, acc, allowed, window);
  }
  return finalize(acc, window);
};
