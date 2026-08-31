/**
 * The window-bucketing and chunked-fetch mechanics both traffic
 * aggregations run on: `/traffic`'s guild-wide accumulator and the
 * per-user one behind `/traffic_me` / `/traffic_user`. Only the folding
 * differs between them, so the bucket layout, the counter bump, the
 * bucket lookup, the window length, and the day-sized fetch loop live
 * here rather than in two copies.
 *
 * Day-sized chunks are the heap discipline: a 30-day window never holds
 * more than a day of documents at once.
 */
import type { Repos } from '../../../persistence/repositories';
import type { MessageDoc } from '../../../persistence/schemas/message.schema';

import type { BucketCount, TimeWindow } from './types';
import { DAY_MS } from './window';

/** The window's contiguous, zero-filled bucket layout. */
export const createBuckets = (window: TimeWindow): BucketCount[] => {
  const buckets: BucketCount[] = [];
  for (let i = 0; i < window.bucketCount; i++) {
    buckets.push({ startMs: window.startMs + i * window.bucketMs, count: 0 });
  }
  return buckets;
};

/** Increment a counter map's entry, seeding an absent key at 0. */
export const bump = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

/**
 * Count `timestampMs` into its bucket. A timestamp outside the window
 * is dropped: the caller's query bounds already exclude it, so an
 * out-of-range index means a clock skew, not a bucket to grow.
 */
export const bumpBucket = (
  buckets: readonly BucketCount[],
  window: TimeWindow,
  timestampMs: number,
): void => {
  const idx = Math.floor((timestampMs - window.startMs) / window.bucketMs);
  if (idx < 0 || idx >= buckets.length) return;
  const bucket = buckets[idx];
  if (bucket) bucket.count++;
};

/**
 * Peak and trough bucket in a single pass. On a tie the earliest bucket
 * wins, so a flat window reports its first bucket rather than its last.
 * Both are `null` only for an empty layout.
 */
export const bucketExtremes = (
  buckets: readonly BucketCount[],
): { readonly busiest: BucketCount | null; readonly quietest: BucketCount | null } => {
  let busiest: BucketCount | null = null;
  let quietest: BucketCount | null = null;
  for (const bucket of buckets) {
    if (busiest === null || bucket.count > busiest.count) busiest = bucket;
    if (quietest === null || bucket.count < quietest.count) quietest = bucket;
  }
  return { busiest, quietest };
};

/** Window length in days, floored at 1 so a sub-day window still averages. */
export const windowDaysOf = (window: TimeWindow): number =>
  Math.max(1, (window.endMs - window.startMs) / DAY_MS);

/**
 * Walk the window a day at a time, handing each chunk to `fold`. A repo
 * error is re-thrown to the handler boundary (`replyForError`).
 */
export const forEachDayChunk = async (
  repos: Pick<Repos, 'message'>,
  window: TimeWindow,
  fold: (messages: readonly MessageDoc[]) => void,
): Promise<void> => {
  for (let chunkStart = window.startMs; chunkStart < window.endMs; chunkStart += DAY_MS) {
    const chunkEnd = Math.min(chunkStart + DAY_MS, window.endMs);
    const result = await repos.message.findByTimestampRange(chunkStart, chunkEnd);
    if (!result.ok) throw result.error;
    fold(result.value);
  }
};
