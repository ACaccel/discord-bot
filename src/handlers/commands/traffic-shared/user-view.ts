/**
 * Assemble a per-user traffic payload — an overview embed carrying a
 * personal time-trend line chart, plus a personal channel-distribution
 * bar chart — shared by `/traffic_me` and `/traffic_user`. The i18n
 * namespace is selected by `keyPrefix`, so each command reads its own
 * labels (e.g. `/traffic_user`'s titles carry the target's name while
 * `/traffic_me`'s read in the second person); the shared charts and the
 * `replies:traffic.*` range / y-axis labels are reused as-is. All text
 * flows through the injected translator (CJK-free, echo-testable).
 * Channel-bar percentages are relative to the focus user's own total, so
 * each bar reads as "share of this user's messages".
 */
import { EmbedBuilder, type AttachmentBuilder, type Guild } from 'discord.js';

import type { UserTrafficAggregate } from './aggregation-user';
import { renderRankingBarChart, renderTimeSeriesChart, type ChartRow } from './chart';
import type { TFn, TrafficRange } from './types';
import { bucketLabel } from './window';

/** Selects the `replies:<prefix>.*` catalog namespace for the labels. */
export type TrafficStatsKeyPrefix = 'traffic_me' | 'traffic_user';

const EMBED_COLOR = 0x5865f2;
const TIME_FILE = 'traffic-time.png';
const CHANNELS_FILE = 'traffic-channels.png';

export interface UserTrafficView {
  readonly embeds: EmbedBuilder[];
  readonly files: AttachmentBuilder[];
}

const busiestValue = (agg: UserTrafficAggregate, prefix: TrafficStatsKeyPrefix, t: TFn): string =>
  agg.busiest === null
    ? t(`replies:${prefix}.busiest_none`)
    : t(`replies:${prefix}.busiest_value`, {
        label: bucketLabel(agg.busiest.startMs, agg.bucket),
        count: agg.busiest.count,
      });

const rankValue = (agg: UserTrafficAggregate, prefix: TrafficStatsKeyPrefix, t: TFn): string =>
  agg.rank > 0
    ? t(`replies:${prefix}.rank_value`, { rank: agg.rank, total: agg.activeUsers })
    : t(`replies:${prefix}.rank_none`);

const overviewEmbed = (
  agg: UserTrafficAggregate,
  range: TrafficRange,
  displayName: string,
  prefix: TrafficStatsKeyPrefix,
  t: TFn,
): EmbedBuilder => {
  const share = agg.guildTotal > 0 ? ((agg.userTotal / agg.guildTotal) * 100).toFixed(1) : '0.0';
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(
      t(`replies:${prefix}.title`, {
        user: displayName,
        range: t(`replies:traffic.range_${range}`),
      }),
    )
    .setImage(`attachment://${TIME_FILE}`)
    .addFields(
      { name: t(`replies:${prefix}.field_total`), value: String(agg.userTotal), inline: true },
      {
        name: t(`replies:${prefix}.field_daily_average`),
        value: agg.dailyAverage.toFixed(1),
        inline: true,
      },
      { name: t(`replies:${prefix}.field_share`), value: `${share}%`, inline: true },
      {
        name: t(`replies:${prefix}.field_busiest`),
        value: busiestValue(agg, prefix, t),
        inline: true,
      },
      { name: t(`replies:${prefix}.field_rank`), value: rankValue(agg, prefix, t), inline: true },
      {
        name: t(`replies:${prefix}.field_active_channels`),
        value: String(agg.perChannel.size),
        inline: true,
      },
    );
};

/** The user's Top-N channels (name resolved cache -> stored -> id), desc. */
export const resolveTopChannels = (
  agg: UserTrafficAggregate,
  guild: Guild,
  topN: number,
): ChartRow[] => {
  const resolveChannel = (id: string): string =>
    guild.channels.cache.get(id)?.name ?? agg.channelNames.get(id) ?? id;
  return [...agg.perChannel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id, value]) => ({ label: resolveChannel(id), value }));
};

export const buildUserTrafficView = (
  agg: UserTrafficAggregate,
  topN: number,
  range: TrafficRange,
  displayName: string,
  guild: Guild,
  t: TFn,
  keyPrefix: TrafficStatsKeyPrefix,
): UserTrafficView => {
  const channelRows = resolveTopChannels(agg, guild, topN);
  const timePoints: ChartRow[] = agg.buckets.map((b) => ({
    label: bucketLabel(b.startMs, agg.bucket),
    value: b.count,
  }));

  const channelsTitle = t(`replies:${keyPrefix}.channels_title`, { user: displayName });
  const files = [
    renderTimeSeriesChart(
      t(`replies:${keyPrefix}.chart_time_title`, { user: displayName }),
      t('replies:traffic.chart_y_axis'),
      timePoints,
      TIME_FILE,
    ),
    renderRankingBarChart(channelsTitle, channelRows, agg.userTotal, CHANNELS_FILE),
  ];

  const channelsEmbed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(channelsTitle)
    .setImage(`attachment://${CHANNELS_FILE}`);

  return {
    embeds: [overviewEmbed(agg, range, displayName, keyPrefix, t), channelsEmbed],
    files,
  };
};
