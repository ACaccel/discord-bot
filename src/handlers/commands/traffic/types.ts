/**
 * `/traffic`-specific shapes. Cross-cutting types shared with
 * `/traffic_me` live in `../traffic-shared/types` and are re-exported
 * here so this command's siblings keep importing from `./types`.
 */
import type {
  BucketCount,
  BucketGranularity,
  TrafficRange,
  Visibility,
} from '../traffic-shared/types';

export type {
  Visibility,
  TrafficRange,
  BucketGranularity,
  TimeWindow,
  BucketCount,
  TFn,
} from '../traffic-shared/types';

/** Parsed and clamped command options. */
export interface TrafficOptions {
  readonly visibility: Visibility;
  readonly range: TrafficRange;
  readonly topN: number;
}

/**
 * Most-used reaction emoji over the window. `id` is the custom-emoji
 * snowflake (null for a unicode emoji, whose `name` is the character
 * itself); `animated` drives the `<a:…>` vs `<:…>` render token.
 */
export interface TopReaction {
  readonly name: string;
  readonly id: string | null;
  readonly animated: boolean;
  readonly count: number;
}

/**
 * Volume comparison against the immediately preceding equal-length
 * window. `percentChange` is `null` when the previous window held no
 * visible messages (no baseline to grow from).
 */
export interface TrafficTrend {
  readonly previousTotal: number;
  readonly percentChange: number | null;
}

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
