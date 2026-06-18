/**
 * Assemble the user-facing `/traffic` payload: three embeds (overview +
 * channel ranking + user ranking) and the data the chart renderer needs.
 * The ranking embeds carry only a title + chart image — the per-row
 * numbers live on the bars themselves, so a duplicate text table is
 * omitted. The overview embed lives in `./overview`. Display names
 * resolve cache -> stored snapshot -> raw id. All strings flow through
 * the injected translator (CJK-free, echo-testable).
 */
import { EmbedBuilder, type Guild } from 'discord.js';

import {
  CHANNELS_CHART_FILE,
  USERS_CHART_FILE,
  type ChartRow,
  type TrafficChartData,
} from '../traffic-shared/chart';
import { bucketLabel } from '../traffic-shared/window';

import { buildOverviewEmbed } from './overview';
import type { TFn, TrafficAggregate, TrafficRange, TrafficTrend } from './types';

const EMBED_COLOR = 0x5865f2;

export interface TrafficView {
  readonly embeds: EmbedBuilder[];
  readonly charts: TrafficChartData;
}

const topRows = (
  counts: ReadonlyMap<string, number>,
  resolveName: (id: string) => string,
  topN: number,
): ChartRow[] =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id, value]) => ({ label: resolveName(id), value }));

const buildRankingEmbed = (title: string, chartFile: string): EmbedBuilder =>
  new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title).setImage(`attachment://${chartFile}`);

export const buildTrafficView = (
  agg: TrafficAggregate,
  topN: number,
  range: TrafficRange,
  trend: TrafficTrend,
  guild: Guild,
  t: TFn,
): TrafficView => {
  const resolveChannel = (id: string): string =>
    guild.channels.cache.get(id)?.name ?? agg.channelNames.get(id) ?? id;
  const resolveUser = (id: string): string =>
    guild.members.cache.get(id)?.displayName ?? agg.userNames.get(id) ?? id;

  const channelsTitle = t('replies:traffic.channels_title');
  const usersTitle = t('replies:traffic.users_title');

  const charts: TrafficChartData = {
    total: agg.totalMessages,
    timeTitle: t('replies:traffic.chart_time_title'),
    timeYAxisLabel: t('replies:traffic.chart_y_axis'),
    timePoints: agg.buckets.map((b) => ({
      label: bucketLabel(b.startMs, agg.bucket),
      value: b.count,
    })),
    channelsTitle,
    channelRows: topRows(agg.perChannel, resolveChannel, topN),
    usersTitle,
    userRows: topRows(agg.perUser, resolveUser, topN),
  };

  return {
    embeds: [
      buildOverviewEmbed(agg, range, trend, t),
      buildRankingEmbed(channelsTitle, CHANNELS_CHART_FILE),
      buildRankingEmbed(usersTitle, USERS_CHART_FILE),
    ],
    charts,
  };
};
