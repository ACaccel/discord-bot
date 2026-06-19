/**
 * Parse and clamp the shared `visibility` / `range` / `top_n` options for
 * the per-user traffic commands (`/traffic_me`, `/traffic_user`).
 * `visibility` mirrors `/traffic`: `ephemeral` (default) replies privately;
 * `public` posts the stats to the channel and — through the shared
 * visibility filter — counts only public-channel activity, so a public
 * reply never reveals that the invoker is active in restricted channels.
 *
 * A command-specific option (e.g. `/traffic_user`'s required `user`) is
 * read in the handler, not here, so this stays focused on the common trio.
 */
import type { ChatInputCommandInteraction } from 'discord.js';

import type { TrafficRange, Visibility } from './types';

export interface TrafficStatsOptions {
  readonly visibility: Visibility;
  readonly range: TrafficRange;
  readonly topN: number;
}

const DEFAULT_VISIBILITY: Visibility = 'ephemeral';
const DEFAULT_RANGE: TrafficRange = '7d';
const DEFAULT_TOP_N = 10;
const MIN_TOP_N = 1;
const MAX_TOP_N = 25;

const VISIBILITIES: ReadonlySet<string> = new Set<Visibility>(['ephemeral', 'public']);
const RANGES: ReadonlySet<string> = new Set<TrafficRange>(['24h', '7d', '30d']);

const clampTopN = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_TOP_N;
  return Math.min(MAX_TOP_N, Math.max(MIN_TOP_N, Math.floor(value)));
};

export const readTrafficStatsOptions = (
  interaction: Pick<ChatInputCommandInteraction, 'options'>,
): TrafficStatsOptions => {
  const rawVisibility = interaction.options.get('visibility')?.value;
  const rawRange = interaction.options.get('range')?.value;
  const rawTopN = interaction.options.get('top_n')?.value;
  const visibility =
    typeof rawVisibility === 'string' && VISIBILITIES.has(rawVisibility)
      ? (rawVisibility as Visibility)
      : DEFAULT_VISIBILITY;
  const range =
    typeof rawRange === 'string' && RANGES.has(rawRange)
      ? (rawRange as TrafficRange)
      : DEFAULT_RANGE;
  const topN = clampTopN(typeof rawTopN === 'number' ? rawTopN : DEFAULT_TOP_N);
  return { visibility, range, topN };
};
