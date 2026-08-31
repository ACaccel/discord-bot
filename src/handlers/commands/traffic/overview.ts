/**
 * Build the `/traffic` overview embed: the privacy-filtered headline
 * stats, laid out as inline fields and carrying the time-trend chart.
 * Extracted from `view.ts` to keep each handler file under the 150-line
 * cap. Every value is either a locale-neutral number / percent or flows
 * through the injected translator, so the module stays CJK-free.
 */
import { EmbedBuilder } from 'discord.js';

import { TIME_CHART_FILE } from '../traffic-shared/chart';
import type { BucketCount, BucketGranularity, TFn, TrafficRange } from '../traffic-shared/types';
import { bucketLabel } from '../traffic-shared/window';

import type { TrafficAggregate } from './aggregation';
import type { TopReaction } from './reactions';
import type { TrafficTrend } from './trend';

const EMBED_COLOR = 0x5865f2;

/** A bucket rendered as "label (count)", or the neutral none-marker. */
const bucketFieldValue = (
  bucket: BucketCount | null,
  granularity: BucketGranularity,
  t: TFn,
): string =>
  bucket === null
    ? t('replies:traffic.busiest_none')
    : t('replies:traffic.busiest_value', {
        label: bucketLabel(bucket.startMs, granularity),
        count: bucket.count,
      });

// Custom emoji render via the `<:name:id>` (animated `<a:…>`) token;
// a unicode reaction's `name` is the character itself.
const reactionToken = (top: TopReaction): string =>
  top.id === null ? top.name : `<${top.animated ? 'a' : ''}:${top.name}:${top.id}>`;

const topReactionValue = (top: TopReaction | null, t: TFn): string =>
  top === null
    ? t('replies:traffic.top_reaction_none')
    : t('replies:traffic.top_reaction_value', { emoji: reactionToken(top), count: top.count });

/** Signed percentage (e.g. "+12.3%" / "-4.0%"), or the no-baseline marker. */
const trendFieldValue = (trend: TrafficTrend, t: TFn): string => {
  if (trend.percentChange === null) return t('replies:traffic.trend_none');
  const sign = trend.percentChange >= 0 ? '+' : '';
  return `${sign}${trend.percentChange.toFixed(1)}%`;
};

/** Share of all visible messages posted by the single most active user. */
const topShareValue = (agg: TrafficAggregate): string => {
  const pct = agg.totalMessages > 0 ? (agg.topUserCount / agg.totalMessages) * 100 : 0;
  return `${pct.toFixed(1)}%`;
};

export const buildOverviewEmbed = (
  agg: TrafficAggregate,
  range: TrafficRange,
  trend: TrafficTrend,
  t: TFn,
): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(t('replies:traffic.title', { range: t(`replies:traffic.range_${range}`) }))
    .setImage(`attachment://${TIME_CHART_FILE}`)
    .addFields(
      { name: t('replies:traffic.field_total'), value: String(agg.totalMessages), inline: true },
      {
        name: t('replies:traffic.field_daily_average'),
        value: agg.dailyAverage.toFixed(1),
        inline: true,
      },
      { name: t('replies:traffic.field_trend'), value: trendFieldValue(trend, t), inline: true },
      {
        name: t('replies:traffic.field_active_channels'),
        value: String(agg.activeChannels),
        inline: true,
      },
      {
        name: t('replies:traffic.field_active_users'),
        value: String(agg.activeUsers),
        inline: true,
      },
      { name: t('replies:traffic.field_top_share'), value: topShareValue(agg), inline: true },
      {
        name: t('replies:traffic.field_busiest'),
        value: bucketFieldValue(agg.busiest, agg.bucket, t),
        inline: true,
      },
      {
        name: t('replies:traffic.field_quietest'),
        value: bucketFieldValue(agg.quietest, agg.bucket, t),
        inline: true,
      },
      {
        name: t('replies:traffic.field_reactions'),
        value: String(agg.totalReactions),
        inline: true,
      },
      {
        name: t('replies:traffic.field_top_reaction'),
        value: topReactionValue(agg.topReaction, t),
        inline: true,
      },
    );
