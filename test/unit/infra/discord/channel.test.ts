/**
 * Unit tests for {@link parentChannelIdOf} — the single safe parent-id
 * extraction that replaced the scattered `(channel as TextChannel).parentId`
 * casts at the three rank-suppression call sites. The whole effective-rank
 * parent propagation rests on this returning the right value for every channel
 * shape, so every branch is pinned here.
 */
import { describe, expect, it } from 'vitest';
import type { Channel } from 'discord.js';

import { parentChannelIdOf } from '../../../../src/infra/discord';

describe('parentChannelIdOf', () => {
  it('returns null for null or undefined input', () => {
    expect(parentChannelIdOf(null)).toBeNull();
    expect(parentChannelIdOf(undefined)).toBeNull();
  });

  it("returns a thread's parent id", () => {
    expect(parentChannelIdOf({ parentId: 'forum-1' } as unknown as Channel)).toBe('forum-1');
  });

  it('returns null for a top-level channel (parentId null)', () => {
    expect(parentChannelIdOf({ parentId: null } as unknown as Channel)).toBeNull();
  });

  it('returns null for a channel type that has no parentId property', () => {
    expect(parentChannelIdOf({ id: 'c1' } as unknown as Channel)).toBeNull();
  });
});
