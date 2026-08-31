/**
 * Unit coverage for the `/traffic` view assembly: three embeds, display
 * name resolution (cache -> stored snapshot -> raw id), top-N ordering,
 * and chart wiring. Uses an echo translator so assertions pin the
 * catalog keys without a real catalog. The overview embed's fields are
 * covered separately in `overview.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { buildTrafficView } from '../../../../src/handlers/commands/traffic/view';
import type { TrafficAggregate } from '../../../../src/handlers/commands/traffic/aggregation';
import type { TrafficTrend } from '../../../../src/handlers/commands/traffic/trend';
import type { TFn } from '../../../../src/handlers/commands/traffic-shared/types';
import { buildTextChannel } from '../../../fixtures/discord/channel-builder';
import { buildGuild } from '../../../fixtures/discord/guild-builder';

const echo: TFn = (key) => key;

const aggregate: TrafficAggregate = {
  totalMessages: 8,
  perChannel: new Map([
    ['c1', 5],
    ['c2', 3],
    ['c3', 1],
  ]),
  channelNames: new Map([['c2', 'stored-c2']]),
  perUser: new Map([
    ['u1', 6],
    ['u2', 2],
  ]),
  userNames: new Map([['u2', 'stored-u2']]),
  buckets: [{ startMs: 1_700_000_000_000, count: 8 }],
  bucket: 'day',
  totalReactions: 4,
  topReaction: { name: 'thumbsup', id: null, animated: false, count: 4 },
  activeChannels: 3,
  activeUsers: 2,
  topUserCount: 6,
  dailyAverage: 1.1,
  busiest: { startMs: 1_700_000_000_000, count: 8 },
  quietest: { startMs: 1_700_000_000_000, count: 8 },
  windowDays: 7,
};

const trend: TrafficTrend = { previousTotal: 4, percentChange: 100 };

const guild = buildGuild({
  channels: [buildTextChannel({ id: 'c1', name: 'live-c1' })],
  members: [{ id: 'u1', displayName: 'live-u1' }],
});

describe('buildTrafficView', () => {
  it('produces three embeds with chart attachments wired in order', () => {
    const view = buildTrafficView(aggregate, 3, '7d', trend, guild, echo);
    expect(view.embeds).toHaveLength(3);
    expect(view.embeds[0]?.data.title).toBe('replies:traffic.title');
    expect(view.embeds[0]?.data.image?.url).toBe('attachment://traffic-time.png');
    expect(view.embeds[1]?.data.image?.url).toBe('attachment://traffic-channels.png');
    expect(view.embeds[2]?.data.image?.url).toBe('attachment://traffic-users.png');
  });

  it('passes the message total and y-axis label through to the chart data', () => {
    const view = buildTrafficView(aggregate, 3, '7d', trend, guild, echo);
    expect(view.charts.total).toBe(8);
    expect(view.charts.timeYAxisLabel).toBe('replies:traffic.chart_y_axis');
  });

  it('resolves names cache -> stored snapshot -> raw id, sorted by count desc', () => {
    const view = buildTrafficView(aggregate, 3, '7d', trend, guild, echo);
    expect(view.charts.channelRows.map((r) => r.label)).toEqual(['live-c1', 'stored-c2', 'c3']);
    expect(view.charts.channelRows.map((r) => r.value)).toEqual([5, 3, 1]);
    expect(view.charts.userRows.map((r) => r.label)).toEqual(['live-u1', 'stored-u2']);
  });

  it('honours top_n by slicing the ranked lists', () => {
    const view = buildTrafficView(aggregate, 1, '7d', trend, guild, echo);
    expect(view.charts.channelRows).toHaveLength(1);
    expect(view.charts.channelRows[0]?.label).toBe('live-c1');
  });

  it('leaves the ranking embeds chart-only (no duplicate text table)', () => {
    const view = buildTrafficView(aggregate, 3, '7d', trend, guild, echo);
    expect(view.embeds[1]?.data.description).toBeUndefined();
    expect(view.embeds[2]?.data.description).toBeUndefined();
  });
});
