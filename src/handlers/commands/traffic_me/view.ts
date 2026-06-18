/**
 * Assemble the `/traffic_me` payload: an overview embed (the invoker's
 * own message stats) carrying a personal time-trend line chart, plus a
 * personal channel-distribution bar chart. Reuses the shared chart
 * renderers; all text flows through the injected translator (CJK-free,
 * echo-testable). Channel-bar percentages are relative to the user's own
 * total, so each bar reads as "share of my messages".
 */
import { EmbedBuilder, type AttachmentBuilder, type Guild } from 'discord.js';

import {
  renderRankingBarChart,
  renderTimeSeriesChart,
  type ChartRow,
} from '../traffic-shared/chart';
import type { TFn, TrafficRange } from '../traffic-shared/types';
import { bucketLabel } from '../traffic-shared/window';

import type { UserTrafficAggregate } from './aggregation-user';

const EMBED_COLOR = 0x5865f2;
const TIME_FILE = 'traffic-me-time.png';
const CHANNELS_FILE = 'traffic-me-channels.png';

export interface TrafficMeView {
  readonly embeds: EmbedBuilder[];
  readonly files: AttachmentBuilder[];
}

const busiestValue = (agg: UserTrafficAggregate, t: TFn): string =>
  agg.busiest === null
    ? t('replies:traffic_me.busiest_none')
    : t('replies:traffic_me.busiest_value', {
        label: bucketLabel(agg.busiest.startMs, agg.bucket),
        count: agg.busiest.count,
      });

const rankValue = (agg: UserTrafficAggregate, t: TFn): string =>
  agg.rank > 0
    ? t('replies:traffic_me.rank_value', { rank: agg.rank, total: agg.activeUsers })
    : t('replies:traffic_me.rank_none');

const overviewEmbed = (
  agg: UserTrafficAggregate,
  range: TrafficRange,
  displayName: string,
  t: TFn,
): EmbedBuilder => {
  const share = agg.guildTotal > 0 ? ((agg.userTotal / agg.guildTotal) * 100).toFixed(1) : '0.0';
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(
      t('replies:traffic_me.title', {
        user: displayName,
        range: t(`replies:traffic.range_${range}`),
      }),
    )
    .setImage(`attachment://${TIME_FILE}`)
    .addFields(
      { name: t('replies:traffic_me.field_total'), value: String(agg.userTotal), inline: true },
      {
        name: t('replies:traffic_me.field_daily_average'),
        value: agg.dailyAverage.toFixed(1),
        inline: true,
      },
      { name: t('replies:traffic_me.field_share'), value: `${share}%`, inline: true },
      { name: t('replies:traffic_me.field_busiest'), value: busiestValue(agg, t), inline: true },
      { name: t('replies:traffic_me.field_rank'), value: rankValue(agg, t), inline: true },
      {
        name: t('replies:traffic_me.field_active_channels'),
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

export const buildTrafficMeView = (
  agg: UserTrafficAggregate,
  topN: number,
  range: TrafficRange,
  displayName: string,
  guild: Guild,
  t: TFn,
): TrafficMeView => {
  const channelRows = resolveTopChannels(agg, guild, topN);
  const timePoints: ChartRow[] = agg.buckets.map((b) => ({
    label: bucketLabel(b.startMs, agg.bucket),
    value: b.count,
  }));

  const channelsTitle = t('replies:traffic_me.channels_title');
  const files = [
    renderTimeSeriesChart(
      t('replies:traffic_me.chart_time_title', { user: displayName }),
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

  return { embeds: [overviewEmbed(agg, range, displayName, t), channelsEmbed], files };
};
