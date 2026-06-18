/**
 * Unit coverage for `/traffic_me` view assembly: two embeds + two chart
 * files, attachment wiring, channel-name resolution / ordering, and the
 * overview field values (share %, totals). Echo translator pins keys.
 */
import { describe, expect, it } from 'vitest';

import type { UserTrafficAggregate } from '../../../../src/handlers/commands/traffic_me/aggregation-user';
import {
  buildTrafficMeView,
  resolveTopChannels,
} from '../../../../src/handlers/commands/traffic_me/view';
import type { TFn } from '../../../../src/handlers/commands/traffic-shared/types';
import { buildTextChannel } from '../../../fixtures/discord/channel-builder';
import { buildGuild } from '../../../fixtures/discord/guild-builder';

const echo: TFn = (key) => key;

const agg: UserTrafficAggregate = {
  userTotal: 10,
  guildTotal: 50,
  perChannel: new Map([
    ['c1', 7],
    ['c2', 3],
  ]),
  channelNames: new Map([['c2', 'stored-c2']]),
  buckets: [{ startMs: 1_700_000_000_000, count: 10 }],
  bucket: 'day',
  busiest: { startMs: 1_700_000_000_000, count: 10 },
  dailyAverage: 1.4,
  rank: 2,
  activeUsers: 8,
  windowDays: 7,
};

const guild = buildGuild({ channels: [buildTextChannel({ id: 'c1', name: 'live-c1' })] });

describe('resolveTopChannels', () => {
  it('resolves names cache -> stored -> id, sorted desc, sliced to topN', () => {
    expect(resolveTopChannels(agg, guild, 5).map((r) => r.label)).toEqual(['live-c1', 'stored-c2']);
    expect(resolveTopChannels(agg, guild, 1).map((r) => r.label)).toEqual(['live-c1']);
  });
});

describe('buildTrafficMeView', () => {
  it('produces two embeds + two chart files wired in order', () => {
    const view = buildTrafficMeView(agg, 5, '7d', 'TestUser', guild, echo);
    expect(view.embeds).toHaveLength(2);
    expect(view.files.map((f) => f.name)).toEqual([
      'traffic-me-time.png',
      'traffic-me-channels.png',
    ]);
    expect(view.embeds[0]?.data.image?.url).toBe('attachment://traffic-me-time.png');
    expect(view.embeds[1]?.data.image?.url).toBe('attachment://traffic-me-channels.png');
  });

  it('shows the share of visible traffic in the overview fields', () => {
    const view = buildTrafficMeView(agg, 5, '7d', 'TestUser', guild, echo);
    const fields = view.embeds[0]?.data.fields ?? [];
    const values = fields.map((f) => f.value);
    expect(values).toContain('10'); // total
    expect(values).toContain('20.0%'); // 10 / 50
  });
});
