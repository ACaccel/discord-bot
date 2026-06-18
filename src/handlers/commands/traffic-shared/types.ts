/**
 * Cross-cutting types shared by the `/traffic` command family
 * (`/traffic`, `/traffic_me`). Command-specific shapes (e.g. each
 * command's options / aggregate) stay in the command's own folder.
 */
export type Visibility = 'ephemeral' | 'public';
export type TrafficRange = '24h' | '7d' | '30d';
export type BucketGranularity = 'hour' | 'day';

/** A resolved look-back window with its contiguous bucket layout. */
export interface TimeWindow {
  readonly startMs: number;
  readonly endMs: number;
  readonly bucket: BucketGranularity;
  readonly bucketMs: number;
  readonly bucketCount: number;
}

/** One contiguous time bucket. `count` is mutated during accumulation. */
export interface BucketCount {
  readonly startMs: number;
  count: number;
}

/** Translator function compatible with `bot.translator.t`. */
export type TFn = (key: string, params?: Record<string, string | number>) => string;
