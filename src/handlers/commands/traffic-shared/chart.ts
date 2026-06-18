/**
 * Public surface for the /traffic chart renderers. Keeps `./chart` as the
 * stable import path (renderers + types + file-name constants) while the
 * drawing code lives in cohesive siblings (`chart-common` / `chart-time` /
 * `chart-bar`) under the 150-line handler cap.
 */
import type { AttachmentBuilder } from 'discord.js';

import { renderRankingBarChart } from './chart-bar';
import {
  CHANNELS_CHART_FILE,
  TIME_CHART_FILE,
  USERS_CHART_FILE,
  type TrafficChartData,
} from './chart-common';
import { renderTimeSeriesChart } from './chart-time';

export {
  CHANNELS_CHART_FILE,
  TIME_CHART_FILE,
  USERS_CHART_FILE,
  type ChartRow,
  type TrafficChartData,
} from './chart-common';
export { renderTimeSeriesChart } from './chart-time';
export { renderRankingBarChart } from './chart-bar';

/** Render all three traffic charts in display order. */
export const renderTrafficCharts = (data: TrafficChartData): AttachmentBuilder[] => [
  renderTimeSeriesChart(data.timeTitle, data.timeYAxisLabel, data.timePoints, TIME_CHART_FILE),
  renderRankingBarChart(data.channelsTitle, data.channelRows, data.total, CHANNELS_CHART_FILE),
  renderRankingBarChart(data.usersTitle, data.userRows, data.total, USERS_CHART_FILE),
];
