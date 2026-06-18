/**
 * Unit coverage for the `/traffic` overview embed: the ten headline
 * fields, the signed-percentage trend (positive / negative / no
 * baseline), the top-contributor share computed against the visible
 * total, and the reaction / bucket none-markers. An echo translator pins
 * the catalog keys; computed values (percentages) are asserted directly.
 */
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { buildOverviewEmbed } from '../../../../src/handlers/commands/traffic/overview';
import type {
  TFn,
  TrafficAggregate,
  TrafficTrend,
} from '../../../../src/handlers/commands/traffic/types';

const echo: TFn = (key) => key;

const baseAggregate: TrafficAggregate = {
  totalMessages: 8,
  perChannel: new Map([['c1', 6]]),
  channelNames: new Map(),
  perUser: new Map([['u1', 6]]),
  userNames: new Map(),
  buckets: [{ startMs: 1_700_000_000_000, count: 8 }],
  bucket: 'day',
  totalReactions: 4,
  topReaction: { name: 'thumbsup', id: null, animated: false, count: 4 },
  activeChannels: 1,
  activeUsers: 2,
  topUserCount: 6,
  dailyAverage: 1.1,
  busiest: { startMs: 1_700_000_000_000, count: 8 },
  quietest: { startMs: 1_700_086_400_000, count: 0 },
  windowDays: 7,
};

const growth: TrafficTrend = { previousTotal: 4, percentChange: 100 };

const fieldValue = (embed: EmbedBuilder, name: string): string | undefined =>
  embed.data.fields?.find((f) => f.name === name)?.value;

describe('buildOverviewEmbed', () => {
  it('renders ten inline fields carrying the time chart', () => {
    const embed = buildOverviewEmbed(baseAggregate, '7d', growth, echo);
    expect(embed.data.title).toBe('replies:traffic.title');
    expect(embed.data.image?.url).toBe('attachment://traffic-time.png');
    expect(embed.data.fields).toHaveLength(10);
    expect(fieldValue(embed, 'replies:traffic.field_total')).toBe('8');
    expect(fieldValue(embed, 'replies:traffic.field_reactions')).toBe('4');
  });

  it('formats a positive trend with a leading plus', () => {
    const embed = buildOverviewEmbed(
      baseAggregate,
      '7d',
      { previousTotal: 4, percentChange: 12.5 },
      echo,
    );
    expect(fieldValue(embed, 'replies:traffic.field_trend')).toBe('+12.5%');
  });

  it('formats a negative trend without doubling the sign', () => {
    const embed = buildOverviewEmbed(
      baseAggregate,
      '7d',
      { previousTotal: 10, percentChange: -4 },
      echo,
    );
    expect(fieldValue(embed, 'replies:traffic.field_trend')).toBe('-4.0%');
  });

  it('shows the no-baseline marker when the previous window was empty', () => {
    const embed = buildOverviewEmbed(
      baseAggregate,
      '7d',
      { previousTotal: 0, percentChange: null },
      echo,
    );
    expect(fieldValue(embed, 'replies:traffic.field_trend')).toBe('replies:traffic.trend_none');
  });

  it('computes the top contributor share against the visible total', () => {
    const embed = buildOverviewEmbed(baseAggregate, '7d', growth, echo);
    expect(fieldValue(embed, 'replies:traffic.field_top_share')).toBe('75.0%');
  });

  it('renders the top reaction, falling back to a none-marker', () => {
    const withReaction = buildOverviewEmbed(baseAggregate, '7d', growth, echo);
    expect(fieldValue(withReaction, 'replies:traffic.field_top_reaction')).toBe(
      'replies:traffic.top_reaction_value',
    );
    const none = buildOverviewEmbed({ ...baseAggregate, topReaction: null }, '7d', growth, echo);
    expect(fieldValue(none, 'replies:traffic.field_top_reaction')).toBe(
      'replies:traffic.top_reaction_none',
    );
  });

  it('builds the custom-emoji / unicode render token for the top reaction', () => {
    // Interpolating translator so we can see the emoji token, not the key.
    const emoji: TFn = (key, params) =>
      key === 'replies:traffic.top_reaction_value' && params ? String(params['emoji']) : key;
    const custom = buildOverviewEmbed(
      { ...baseAggregate, topReaction: { name: 'pepe', id: '123', animated: false, count: 4 } },
      '7d',
      growth,
      emoji,
    );
    expect(fieldValue(custom, 'replies:traffic.field_top_reaction')).toBe('<:pepe:123>');

    const animated = buildOverviewEmbed(
      { ...baseAggregate, topReaction: { name: 'dance', id: '999', animated: true, count: 4 } },
      '7d',
      growth,
      emoji,
    );
    expect(fieldValue(animated, 'replies:traffic.field_top_reaction')).toBe('<a:dance:999>');

    const unicode = buildOverviewEmbed(
      { ...baseAggregate, topReaction: { name: '🔥', id: null, animated: false, count: 4 } },
      '7d',
      growth,
      emoji,
    );
    expect(fieldValue(unicode, 'replies:traffic.field_top_reaction')).toBe('🔥');
  });

  it('renders busiest and quietest buckets, falling back to a none-marker', () => {
    const withBuckets = buildOverviewEmbed(baseAggregate, '7d', growth, echo);
    expect(fieldValue(withBuckets, 'replies:traffic.field_busiest')).toBe(
      'replies:traffic.busiest_value',
    );
    expect(fieldValue(withBuckets, 'replies:traffic.field_quietest')).toBe(
      'replies:traffic.busiest_value',
    );
    const none = buildOverviewEmbed(
      { ...baseAggregate, busiest: null, quietest: null },
      '7d',
      growth,
      echo,
    );
    expect(fieldValue(none, 'replies:traffic.field_quietest')).toBe('replies:traffic.busiest_none');
  });
});
