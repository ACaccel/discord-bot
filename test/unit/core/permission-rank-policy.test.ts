/**
 * Unit tests for {@link createPermissionRankPolicy}.
 *
 * The policy is the single home of the privacy / clearance decision logic, so
 * it is tested exhaustively here: channel-rank resolution (unlisted = 0,
 * parent-thread max), user-rank resolution (max over roles), the per-feature
 * suppression ceiling (distinct defaults, config override, boundary, unbounded
 * null), the `visibilityCeiling` primitive a future `traffic_status` composes,
 * and fail-fast config validation. Consumers inject a policy built by this
 * same factory, so these tests also pin the fake they rely on.
 */
import { describe, expect, it } from 'vitest';

import { createPermissionRankPolicy, RANKED_FEATURES } from '../../../src/core/plugin';

const GUILD = 'g1';

describe('createPermissionRankPolicy — channelRank', () => {
  it('returns 0 for an unlisted channel and for an unknown guild', () => {
    const policy = createPermissionRankPolicy({ [GUILD]: { channels: { listed: 2 } } });
    expect(policy.channelRank(GUILD, 'listed')).toBe(2);
    expect(policy.channelRank(GUILD, 'unlisted')).toBe(0);
    expect(policy.channelRank('other-guild', 'listed')).toBe(0);
  });

  it('takes the max of the channel and its parent (effective rank is monotonic)', () => {
    const policy = createPermissionRankPolicy({
      [GUILD]: { channels: { child: 0, parent: 2, hot: 3 } },
    });
    expect(policy.channelRank(GUILD, 'child', 'parent')).toBe(2); // parent dominates
    expect(policy.channelRank(GUILD, 'hot', 'parent')).toBe(3); // own dominates
    expect(policy.channelRank(GUILD, 'child', null)).toBe(0); // no parent
    expect(policy.channelRank(GUILD, 'child', undefined)).toBe(0);
    expect(policy.channelRank(GUILD, 'child', 'unlisted-parent')).toBe(0); // both unlisted
  });
});

describe('createPermissionRankPolicy — userRank', () => {
  const policy = createPermissionRankPolicy({
    [GUILD]: { roles: { mod: 1, admin: 3, owner: 3 } },
  });

  it('returns the max rank over the member roles, regardless of order', () => {
    expect(policy.userRank(GUILD, ['mod', 'admin'])).toBe(3);
    expect(policy.userRank(GUILD, ['admin', 'mod'])).toBe(3);
  });

  it('returns 0 for an empty iterable, only-unranked roles, or an unknown guild', () => {
    expect(policy.userRank(GUILD, [])).toBe(0);
    expect(policy.userRank(GUILD, ['unranked', 'nope'])).toBe(0);
    expect(policy.userRank('other-guild', ['admin'])).toBe(0);
  });

  it('accepts any Iterable<string> (e.g. a Set key iterator)', () => {
    expect(policy.userRank(GUILD, new Set(['mod', 'admin']).keys())).toBe(3);
  });

  it('treats an explicit rank-0 role the same as an absent role', () => {
    const p = createPermissionRankPolicy({ [GUILD]: { roles: { base: 0 } } });
    expect(p.userRank(GUILD, ['base'])).toBe(0);
  });
});

describe('createPermissionRankPolicy — isSuppressed (per-feature ceilings)', () => {
  it('applies DISTINCT default ceilings: one rank-1 channel, three outcomes', () => {
    const policy = createPermissionRankPolicy({ [GUILD]: { channels: { priv: 1 } } });
    expect(policy.isSuppressed(GUILD, 'guild_events', 'priv')).toBe(true); // ceiling 0, 1 > 0
    expect(policy.isSuppressed(GUILD, 'channel_logging', 'priv')).toBe(true); // ceiling 0, 1 > 0
    expect(policy.isSuppressed(GUILD, 'social_preview', 'priv')).toBe(false); // ceiling null
  });

  it('suppresses nothing for a rank-0 / unlisted channel under default ceilings', () => {
    const policy = createPermissionRankPolicy({ [GUILD]: { channels: { pub: 0 } } });
    for (const feature of RANKED_FEATURES) {
      expect(policy.isSuppressed(GUILD, feature, 'pub')).toBe(false);
      expect(policy.isSuppressed(GUILD, feature, 'unlisted')).toBe(false);
    }
  });

  it('lets a per-guild ceiling override beat the code default', () => {
    const policy = createPermissionRankPolicy({
      [GUILD]: { channels: { priv: 1 }, features: { social_preview: { maxChannelRank: 0 } } },
    });
    expect(policy.isSuppressed(GUILD, 'social_preview', 'priv')).toBe(true); // now finite
  });

  it('treats an explicit null ceiling as unbounded (never suppresses)', () => {
    const policy = createPermissionRankPolicy({
      [GUILD]: { channels: { priv: 5 }, features: { guild_events: { maxChannelRank: null } } },
    });
    expect(policy.isSuppressed(GUILD, 'guild_events', 'priv')).toBe(false);
  });

  it('boundary: rank == ceiling is NOT suppressed; rank > ceiling is', () => {
    const policy = createPermissionRankPolicy({
      [GUILD]: {
        channels: { atCeiling: 2, above: 3 },
        features: { guild_events: { maxChannelRank: 2 } },
      },
    });
    expect(policy.isSuppressed(GUILD, 'guild_events', 'atCeiling')).toBe(false); // 2 <= 2
    expect(policy.isSuppressed(GUILD, 'guild_events', 'above')).toBe(true); // 3 > 2
  });

  it('considers the parent-thread rank (a thread under a private forum is suppressed)', () => {
    const policy = createPermissionRankPolicy({ [GUILD]: { channels: { forum: 1 } } });
    expect(policy.isSuppressed(GUILD, 'guild_events', 'thread', 'forum')).toBe(true);
    expect(policy.isSuppressed(GUILD, 'guild_events', 'thread', null)).toBe(false);
  });

  it('suppresses nothing when a guild omits its permission_rank block (preserves prior behaviour)', () => {
    const omitted = createPermissionRankPolicy({ [GUILD]: undefined });
    const empty = createPermissionRankPolicy({});
    for (const feature of RANKED_FEATURES) {
      expect(omitted.isSuppressed(GUILD, feature, 'any')).toBe(false);
      expect(empty.isSuppressed('whatever', feature, 'any')).toBe(false);
    }
  });

  it('confirms each default ceiling: guild_events=0, channel_logging=0, social_preview=unbounded', () => {
    const policy = createPermissionRankPolicy({ [GUILD]: { channels: { r1: 1 } } });
    expect(policy.isSuppressed(GUILD, 'guild_events', 'r1')).toBe(true);
    expect(policy.isSuppressed(GUILD, 'channel_logging', 'r1')).toBe(true);
    expect(policy.isSuppressed(GUILD, 'social_preview', 'r1')).toBe(false);
  });
});

describe('createPermissionRankPolicy — visibilityCeiling (traffic_status supportability)', () => {
  it('is min(userRank, commandChannelRank); a consumer filters channels <= it', () => {
    const policy = createPermissionRankPolicy({
      [GUILD]: {
        channels: { cmd: 2, pub: 0, internal: 1, secret: 2, topsecret: 3 },
        roles: { staff: 2 },
      },
    });
    const ceiling = policy.visibilityCeiling(GUILD, ['staff'], 'cmd'); // min(2, 2)
    expect(ceiling).toBe(2);
    const visible = ['pub', 'internal', 'secret', 'topsecret'].filter(
      (channel) => policy.channelRank(GUILD, channel) <= ceiling,
    );
    expect(visible).toEqual(['pub', 'internal', 'secret']); // topsecret (3) excluded
  });

  it('caps a high-clearance user by the command-channel rank (no leak into a public room)', () => {
    const policy = createPermissionRankPolicy({
      [GUILD]: { channels: { pubCmd: 0, secret: 2 }, roles: { admin: 3 } },
    });
    const ceiling = policy.visibilityCeiling(GUILD, ['admin'], 'pubCmd'); // min(3, 0)
    expect(ceiling).toBe(0);
    expect(policy.channelRank(GUILD, 'secret') <= ceiling).toBe(false);
  });

  it('gives an unranked user a ceiling of 0 (only rank-0 channels)', () => {
    const policy = createPermissionRankPolicy({ [GUILD]: { channels: { secret: 1 }, roles: {} } });
    expect(policy.visibilityCeiling(GUILD, [], 'anywhere')).toBe(0);
  });
});

describe('createPermissionRankPolicy — config validation (fail-fast, operator-facing)', () => {
  it('rejects a negative rank, naming the offending guild', () => {
    expect(() => createPermissionRankPolicy({ 'guild-xyz': { channels: { c: -1 } } })).toThrow(
      /Invalid permission_rank config for guild guild-xyz/,
    );
  });

  it('rejects a non-integer rank', () => {
    expect(() => createPermissionRankPolicy({ [GUILD]: { channels: { c: 1.5 } } })).toThrow();
  });

  it('rejects an unknown top-level key (.strict)', () => {
    expect(() => createPermissionRankPolicy({ [GUILD]: { channelz: {} } })).toThrow();
  });

  it('rejects an unknown / out-of-scope feature key (e.g. llm_auto_reply)', () => {
    expect(() =>
      createPermissionRankPolicy({
        [GUILD]: { features: { llm_auto_reply: { maxChannelRank: 0 } } },
      }),
    ).toThrow();
  });

  it('accepts an explicit null maxChannelRank (unbounded) and an omitted block', () => {
    expect(() =>
      createPermissionRankPolicy({
        [GUILD]: { features: { guild_events: { maxChannelRank: null } } },
      }),
    ).not.toThrow();
    expect(() => createPermissionRankPolicy({ [GUILD]: undefined })).not.toThrow();
  });
});

describe('createPermissionRankPolicy — RankedFeature ↔ parser lockstep', () => {
  it('accepts every RankedFeature as a config override and honours it', () => {
    // Catches drift between RAW_DEFAULT_CEILINGS (the source of RankedFeature)
    // and the zod `features` schema: a feature the schema dropped would make
    // `.strict()` throw here, and an override that is parsed but never applied
    // would fail the suppression assertion.
    for (const feature of RANKED_FEATURES) {
      const policy = createPermissionRankPolicy({
        [GUILD]: { channels: { r1: 1 }, features: { [feature]: { maxChannelRank: 0 } } },
      });
      expect(policy.isSuppressed(GUILD, feature, 'r1')).toBe(true); // ceiling 0, rank 1 > 0
    }
  });
});

describe('createPermissionRankPolicy — no runtime dependency', () => {
  it('answers from pure static data, with no Discord client involved', () => {
    const policy = createPermissionRankPolicy({ [GUILD]: { channels: { c: 1 } } });
    expect(policy.channelRank(GUILD, 'c')).toBe(1);
    expect(policy.userRank(GUILD, [])).toBe(0);
  });
});
