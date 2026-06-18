/**
 * Privacy-invariant coverage for the `/traffic` visibility filter.
 *
 * Builds a REAL `PermissionRankPolicy` (the same factory consumers
 * inject) plus channel / member fixtures whose `permissionsFor` stub
 * drives the Discord-native `ViewChannel` answer. Proves the two gates
 * compose and that the rank ceiling tracks the reply audience:
 * `ephemeral` (private) caps by the invoker's clearance alone, `public`
 * also caps by the command channel's rank, and both still require the
 * member's native ViewChannel (so threads inherit their parent's
 * visibility).
 */
import { ChannelType } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { createPermissionRankPolicy } from '../../../../src/core/plugin';
import { buildAllowedChannelSet } from '../../../../src/handlers/commands/traffic-shared/visibility-filter';
import { buildTextChannel } from '../../../fixtures/discord/channel-builder';
import { buildGuild } from '../../../fixtures/discord/guild-builder';
import { buildGuildMember } from '../../../fixtures/discord/member-builder';

const GUILD = 'g1';
const EVERYONE = 'everyone';
const MEMBER = 'u1';

const policy = createPermissionRankPolicy({
  [GUILD]: {
    channels: { internal: 1, secret: 2, topsecret: 3 },
    roles: { staff: 2 },
  },
});

const staff = buildGuildMember({ id: MEMBER, roleIds: ['staff'] });

// pub: public to everyone. team0: rank-0 but member-only. hidden0: rank-0
// viewable by no one. internal/secret/topsecret: ranks 1/2/3, member-only.
const channels = () => [
  buildTextChannel({ id: 'pub', viewableByAll: true }),
  buildTextChannel({ id: 'team0', viewableByAll: false, viewableBy: new Set([MEMBER]) }),
  buildTextChannel({ id: 'hidden0', viewableByAll: false }),
  buildTextChannel({ id: 'internal', viewableByAll: false, viewableBy: new Set([MEMBER]) }),
  buildTextChannel({ id: 'secret', viewableByAll: false, viewableBy: new Set([MEMBER]) }),
  buildTextChannel({ id: 'topsecret', viewableByAll: false, viewableBy: new Set([MEMBER]) }),
];

const guildWith = (chs: ReturnType<typeof channels>) =>
  buildGuild({ id: GUILD, everyoneRoleId: EVERYONE, channels: chs });

describe('buildAllowedChannelSet — ephemeral (private): capped by the invoker rank only', () => {
  it('shows everything up to the invoker rank, regardless of the command channel', () => {
    const allowed = buildAllowedChannelSet({
      guild: guildWith(channels()),
      member: staff,
      policy,
      mode: 'ephemeral',
      commandChannelId: 'pub', // a public room must NOT lower a private reply
    });
    // ceiling = userRank 2; rank<=2 AND member-viewable: internal/secret/pub/team0.
    // topsecret over rank; hidden0 not viewable.
    expect([...allowed].sort()).toEqual(['internal', 'pub', 'secret', 'team0']);
  });

  it('still excludes channels above the invoker rank', () => {
    const allowed = buildAllowedChannelSet({
      guild: guildWith(channels()),
      member: staff,
      policy,
      mode: 'ephemeral',
      commandChannelId: 'secret',
    });
    expect(allowed.has('topsecret')).toBe(false); // rank 3 > userRank 2
  });
});

describe('buildAllowedChannelSet — public: capped by BOTH the command channel and the invoker rank', () => {
  it('lowers to the command-channel rank when it is below the invoker rank', () => {
    const allowed = buildAllowedChannelSet({
      guild: guildWith(channels()),
      member: staff, // userRank 2, but the room is rank 0
      policy,
      mode: 'public',
      commandChannelId: 'pub', // ceiling = min(2, 0) = 0 — only rank-0 channels
    });
    expect([...allowed].sort()).toEqual(['pub', 'team0']);
  });

  it('rises to the command-channel rank, never above the invoker rank', () => {
    const allowed = buildAllowedChannelSet({
      guild: guildWith(channels()),
      member: staff,
      policy,
      mode: 'public',
      commandChannelId: 'secret', // ceiling = min(2, 2) = 2
    });
    expect([...allowed].sort()).toEqual(['internal', 'pub', 'secret', 'team0']);
  });
});

describe('buildAllowedChannelSet — full ancestry (category → channel → thread)', () => {
  // A private category lifts the effective rank of a thread nested two levels
  // under it, even though neither the thread nor its channel is itself ranked.
  const ancestryPolicy = createPermissionRankPolicy({
    [GUILD]: { channels: { 'cat-secret': 2 }, roles: { staff: 2 } },
  });

  const ancestryGuild = () => {
    const category = buildTextChannel({ id: 'cat-secret', viewableByAll: true });
    const channel = buildTextChannel({
      id: 'ch-under-cat',
      parentId: 'cat-secret',
      parent: category,
      viewableByAll: true,
    });
    const thread = buildTextChannel({
      id: 'th-under-cat',
      type: ChannelType.PublicThread,
      parentId: 'ch-under-cat',
      parent: channel,
      viewableByAll: true,
    });
    return buildGuild({
      id: GUILD,
      everyoneRoleId: EVERYONE,
      channels: [category, channel, thread],
    });
  };

  it('lifts a nested channel and thread to the category rank', () => {
    // Unranked invoker → ceiling 0; the thread and its channel both resolve to
    // the category rank (2) via the ancestry walk, so both are excluded.
    const allowed = buildAllowedChannelSet({
      guild: ancestryGuild(),
      member: buildGuildMember({ id: MEMBER, roleIds: [] }),
      policy: ancestryPolicy,
      mode: 'ephemeral',
      commandChannelId: 'cat-secret',
    });
    expect(allowed.has('th-under-cat')).toBe(false);
    expect(allowed.has('ch-under-cat')).toBe(false);
  });

  it('includes the nested thread once the invoker clears the inherited rank', () => {
    // staff userRank 2 → ceiling 2; the thread's inherited rank 2 is within reach.
    const allowed = buildAllowedChannelSet({
      guild: ancestryGuild(),
      member: staff,
      policy: ancestryPolicy,
      mode: 'ephemeral',
      commandChannelId: 'cat-secret',
    });
    expect(allowed.has('th-under-cat')).toBe(true);
    expect(allowed.has('ch-under-cat')).toBe(true);
  });
});

describe('buildAllowedChannelSet — edge cases', () => {
  it('excludes a channel present only in archived data (deleted / uncached)', () => {
    const allowed = buildAllowedChannelSet({
      guild: guildWith(channels()),
      member: staff,
      policy,
      mode: 'ephemeral',
      commandChannelId: 'secret',
    });
    expect(allowed.has('deleted-channel-id')).toBe(false);
  });

  it('gates a thread on its parent channel ViewChannel', () => {
    const openForum = buildTextChannel({
      id: 'forum',
      type: ChannelType.GuildForum,
      viewableByAll: true,
    });
    const closedForum = buildTextChannel({
      id: 'pforum',
      type: ChannelType.GuildForum,
      viewableByAll: false,
    });
    const openThread = buildTextChannel({
      id: 'th-open',
      type: ChannelType.PublicThread,
      parentId: 'forum',
      parent: openForum,
    });
    const closedThread = buildTextChannel({
      id: 'th-closed',
      type: ChannelType.PublicThread,
      parentId: 'pforum',
      parent: closedForum,
    });
    const guild = buildGuild({
      id: GUILD,
      everyoneRoleId: EVERYONE,
      channels: [openForum, closedForum, openThread, closedThread],
    });
    const allowed = buildAllowedChannelSet({
      guild,
      member: buildGuildMember({ id: MEMBER, roleIds: [] }),
      policy,
      mode: 'ephemeral',
      commandChannelId: 'forum',
    });
    expect(allowed.has('th-open')).toBe(true);
    expect(allowed.has('th-closed')).toBe(false);
  });
});
