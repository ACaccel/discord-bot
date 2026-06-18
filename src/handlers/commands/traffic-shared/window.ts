/**
 * Look-back window resolution and bucket time-labelling shared by the
 * traffic commands. `bucketLabel` produces ASCII-only labels (dates /
 * hours), so it carries no CJK literals.
 */
import type { BucketGranularity, TimeWindow, TrafficRange } from './types';

const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

interface RangeSpec {
  readonly spanMs: number;
  readonly bucket: BucketGranularity;
  readonly bucketMs: number;
}

const RANGE_SPECS: Readonly<Record<TrafficRange, RangeSpec>> = {
  '24h': { spanMs: 24 * HOUR_MS, bucket: 'hour', bucketMs: HOUR_MS },
  '7d': { spanMs: 7 * DAY_MS, bucket: 'day', bucketMs: DAY_MS },
  '30d': { spanMs: 30 * DAY_MS, bucket: 'day', bucketMs: DAY_MS },
};

/** Resolve a range token into a concrete window anchored at `nowMs`. */
export const resolveWindow = (range: TrafficRange, nowMs: number): TimeWindow => {
  const spec = RANGE_SPECS[range];
  return {
    startMs: nowMs - spec.spanMs,
    endMs: nowMs,
    bucket: spec.bucket,
    bucketMs: spec.bucketMs,
    bucketCount: Math.round(spec.spanMs / spec.bucketMs),
  };
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Short axis / summary label for a bucket's start time. */
export const bucketLabel = (startMs: number, granularity: BucketGranularity): string => {
  const d = new Date(startMs);
  const dayLabel = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  return granularity === 'hour' ? `${pad2(d.getHours())}:00` : dayLabel;
};
