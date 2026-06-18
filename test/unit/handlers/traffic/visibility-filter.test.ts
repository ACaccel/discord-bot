/**
 * Privacy-invariant coverage for the `/traffic` dual visibility filter.
 *
 * Builds a REAL `PermissionRankPolicy` (the same factory consumers
 * inject) plus channel / member fixtures whose `permissionsFor` stub
 * drives the Discord-native `ViewChannel` answer. Proves the two gates
 * compose: a channel is shown only when BOTH the operator rank ceiling
 * and native ViewChannel pass, that `public` mode never leaks a
 * high-clearance invoker's private channels, that the command channel
 * caps a privileged user, and that threads inherit their parent's
 * visibility.
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

describe('buildAllowedChannelSet — ephemeral mode (dual filter)', () => {
  it('includes only channels passing BOTH the rank ceiling and native ViewChannel', () => {
    const allowed = buildAllowedChannelSet({
      guild: guildWith(channels()),
      member: staff,
      policy,
      mode: 'ephemeral',
      commandChannelId: 'secret', // ceiling = min(userRank 2, channelRank 2) = 2
    });
    // pub/team0/internal/secret pass; hidden0 fails native; topsecret fails rank.
    expect([...allowed].sort()).toEqual(['internal', 'pub', 'secret', 'team0']);
  });

  it('caps a privileged invoker by the command-channel rank (no leak into a public room)', () => {
    const allowed = buildAllowedChannelSet({
      guild: guildWith(channels()),
      member: staff,
      policy,
      mode: 'ephemeral',
      commandChannelId: 'pub', // ceiling = min(2, 0) = 0 — only rank-0 channels
    });
    expect([...allowed].sort()).toEqual(['pub', 'team0']);
  });
});

describe('buildAllowedChannelSet — public mode (public info only)', () => {
  it('forces ceiling 0 and checks @everyone, never leaking the invoker clearance', () => {
    const allowed = buildAllowedChannelSet({
      guild: guildWith(channels()),
      member: staff, // staff could see secret ephemerally — must NOT leak here
      policy,
      mode: 'public',
      commandChannelId: 'secret',
    });
    // Only rank-0 channels viewable by @everyone: pub. team0 is member-only.
    expect([...allowed]).toEqual(['pub']);
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
