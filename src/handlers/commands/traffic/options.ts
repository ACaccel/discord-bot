/**
 * Parse and clamp the `/traffic` command options. Typed against the
 * narrow `options` accessor so unit tests can drive it without a full
 * interaction fixture. Discord enforces the choice / min / max bounds
 * at the API layer; the clamp here is a defence against direct API
 * calls that bypass those constraints.
 */
import type { ChatInputCommandInteraction } from 'discord.js';

import type { TrafficOptions, TrafficRange, Visibility } from './types';

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

export const readTrafficOptions = (
  interaction: Pick<ChatInputCommandInteraction, 'options'>,
): TrafficOptions => {
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
