/**
 * Unit coverage for the shared per-user traffic view assembly
 * (`/traffic_me`, `/traffic_user`): two embeds + two chart files,
 * attachment wiring, channel-name resolution / ordering, the overview
 * field values (share %, totals), and `keyPrefix` namespace routing.
 * Echo translator pins keys.
 */
import { describe, expect, it } from 'vitest';

import type { UserTrafficAggregate } from '../../../../src/handlers/commands/traffic-shared/aggregation-user';
import type { TFn } from '../../../../src/handlers/commands/traffic-shared/types';
import {
  buildUserTrafficView,
  resolveTopChannels,
} from '../../../../src/handlers/commands/traffic-shared/user-view';
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

describe('buildUserTrafficView', () => {
  it('produces two embeds + two chart files wired in order', () => {
    const view = buildUserTrafficView(agg, 5, '7d', 'TestUser', guild, echo, 'traffic_me');
    expect(view.embeds).toHaveLength(2);
    expect(view.files.map((f) => f.name)).toEqual(['traffic-time.png', 'traffic-channels.png']);
    expect(view.embeds[0]?.data.image?.url).toBe('attachment://traffic-time.png');
    expect(view.embeds[1]?.data.image?.url).toBe('attachment://traffic-channels.png');
  });

  it('shows the share of visible traffic in the overview fields', () => {
    const view = buildUserTrafficView(agg, 5, '7d', 'TestUser', guild, echo, 'traffic_me');
    const fields = view.embeds[0]?.data.fields ?? [];
    const values = fields.map((f) => f.value);
    expect(values).toContain('10'); // total
    expect(values).toContain('20.0%'); // 10 / 50
  });

  it('routes labels to the keyPrefix namespace', () => {
    const me = buildUserTrafficView(agg, 5, '7d', 'TestUser', guild, echo, 'traffic_me');
    const user = buildUserTrafficView(agg, 5, '7d', 'TestUser', guild, echo, 'traffic_user');
    expect(me.embeds[0]?.data.title).toBe('replies:traffic_me.title');
    expect(user.embeds[0]?.data.title).toBe('replies:traffic_user.title');
  });
});
