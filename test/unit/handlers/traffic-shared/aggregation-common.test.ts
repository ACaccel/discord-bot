/**
 * Unit coverage for the bucketing / fetch mechanics both traffic
 * aggregations share. These are the parts a wrong edit would silently
 * skew every `/traffic*` chart by, so each is pinned directly rather
 * than only through the two aggregate builders.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  bucketExtremes,
  bump,
  bumpBucket,
  createBuckets,
  forEachDayChunk,
  windowDaysOf,
} from '../../../../src/handlers/commands/traffic-shared/aggregation-common';
import type { TimeWindow } from '../../../../src/handlers/commands/traffic-shared/types';
import { err, ok } from '../../../../src/core/result';
import { databaseErrorFrom } from '../../../../src/persistence/error-translator';
import type { Repos } from '../../../../src/persistence/repositories';
import type { MessageDoc } from '../../../../src/persistence/schemas/message.schema';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const hourlyWindow = (startMs: number, hours: number): TimeWindow => ({
  startMs,
  endMs: startMs + hours * HOUR_MS,
  bucket: 'hour',
  bucketMs: HOUR_MS,
  bucketCount: hours,
});

const repoReturning = (
  chunks: ReadonlyArray<readonly MessageDoc[]>,
): { repos: Pick<Repos, 'message'>; calls: [number, number][] } => {
  const calls: [number, number][] = [];
  let index = 0;
  const findByTimestampRange = vi.fn(async (startMs: number, endMs: number) => {
    calls.push([startMs, endMs]);
    const chunk = chunks[index] ?? [];
    index += 1;
    return ok(chunk);
  });
  return {
    repos: { message: { findByTimestampRange } } as unknown as Pick<Repos, 'message'>,
    calls,
  };
};

describe('createBuckets', () => {
  it('lays out contiguous zero-filled buckets across the window', () => {
    expect(createBuckets(hourlyWindow(1_000, 3))).toEqual([
      { startMs: 1_000, count: 0 },
      { startMs: 1_000 + HOUR_MS, count: 0 },
      { startMs: 1_000 + 2 * HOUR_MS, count: 0 },
    ]);
  });
});

describe('bump', () => {
  it('seeds an absent key at one and increments a present one', () => {
    const counts = new Map<string, number>();
    bump(counts, 'a');
    bump(counts, 'a');
    bump(counts, 'b');
    expect([...counts]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});

describe('bumpBucket', () => {
  const window = hourlyWindow(0, 3);

  it('counts a timestamp into the bucket that contains it', () => {
    const buckets = createBuckets(window);
    bumpBucket(buckets, window, HOUR_MS + 5);
    expect(buckets.map((b) => b.count)).toEqual([0, 1, 0]);
  });

  it('counts the bucket start itself into that bucket', () => {
    const buckets = createBuckets(window);
    bumpBucket(buckets, window, 2 * HOUR_MS);
    expect(buckets.map((b) => b.count)).toEqual([0, 0, 1]);
  });

  it('drops a timestamp outside the window rather than growing an edge bucket', () => {
    const buckets = createBuckets(window);
    bumpBucket(buckets, window, -1);
    bumpBucket(buckets, window, 3 * HOUR_MS);
    expect(buckets.map((b) => b.count)).toEqual([0, 0, 0]);
  });
});

describe('bucketExtremes', () => {
  it('returns the peak and the trough', () => {
    const buckets = [
      { startMs: 0, count: 1 },
      { startMs: 1, count: 7 },
      { startMs: 2, count: 3 },
    ];
    expect(bucketExtremes(buckets)).toEqual({ busiest: buckets[1], quietest: buckets[0] });
  });

  it('breaks a tie in favour of the earliest bucket', () => {
    const buckets = [
      { startMs: 0, count: 4 },
      { startMs: 1, count: 4 },
    ];
    const { busiest, quietest } = bucketExtremes(buckets);
    expect(busiest).toBe(buckets[0]);
    expect(quietest).toBe(buckets[0]);
  });

  it('reports null for an empty layout', () => {
    expect(bucketExtremes([])).toEqual({ busiest: null, quietest: null });
  });
});

describe('windowDaysOf', () => {
  it('returns the window length in days', () => {
    expect(windowDaysOf({ ...hourlyWindow(0, 24), endMs: 7 * DAY_MS })).toBe(7);
  });

  it('floors a sub-day window at one so the daily average stays finite', () => {
    expect(windowDaysOf(hourlyWindow(0, 6))).toBe(1);
  });
});

describe('forEachDayChunk', () => {
  it('walks the window a day at a time and clamps the final chunk to the end', async () => {
    const window: TimeWindow = {
      startMs: 0,
      endMs: DAY_MS + HOUR_MS,
      bucket: 'day',
      bucketMs: DAY_MS,
      bucketCount: 2,
    };
    const { repos, calls } = repoReturning([[], []]);

    await forEachDayChunk(repos, window, () => undefined);

    expect(calls).toEqual([
      [0, DAY_MS],
      [DAY_MS, DAY_MS + HOUR_MS],
    ]);
  });

  it('hands each fetched chunk to the fold', async () => {
    const doc = { messageId: 'm1' } as unknown as MessageDoc;
    const { repos } = repoReturning([[doc]]);
    const seen: MessageDoc[] = [];

    await forEachDayChunk(repos, hourlyWindow(0, 3), (messages) => seen.push(...messages));

    expect(seen).toEqual([doc]);
  });

  it('re-throws a repo error so the handler boundary answers with a trace id', async () => {
    const boom = databaseErrorFrom(new Error('mongo down'), {
      operation: 'MessageRepo.findByTimestampRange',
    });
    const repos = {
      message: { findByTimestampRange: vi.fn(async () => err(boom)) },
    } as unknown as Pick<Repos, 'message'>;

    await expect(forEachDayChunk(repos, hourlyWindow(0, 3), () => undefined)).rejects.toBe(boom);
  });
});
