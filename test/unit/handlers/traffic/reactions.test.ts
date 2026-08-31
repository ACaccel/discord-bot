/**
 * Unit coverage for `/traffic` reaction tallying: custom emojis are
 * keyed by snowflake id (so the same name on two emojis stays distinct),
 * unicode emojis by their character, unnamed reactions are skipped, and
 * `topReactionOf` returns a copy of the most-summed tally.
 */
import { describe, expect, it } from 'vitest';

import {
  tallyReactions,
  topReactionOf,
  type ReactionTally,
} from '../../../../src/handlers/commands/traffic/reactions';

describe('tallyReactions', () => {
  it('keys custom emojis by id and unicode emojis by name, returning the added total', () => {
    const tallies = new Map<string, ReactionTally>();
    const added = tallyReactions(
      [
        { name: 'pepe', id: '111', animated: false, count: 3 },
        { name: 'pepe', id: '222', animated: true, count: 2 }, // same name, different emoji
        { name: '🔥', id: null, count: 4 },
        { name: '🔥', count: 1 }, // merges with the unicode key
      ],
      tallies,
    );
    expect(added).toBe(10);
    expect(tallies.get('111')).toEqual({ name: 'pepe', id: '111', animated: false, count: 3 });
    expect(tallies.get('222')).toEqual({ name: 'pepe', id: '222', animated: true, count: 2 });
    expect(tallies.get('🔥')).toEqual({ name: '🔥', id: null, animated: false, count: 5 });
  });

  it('counts unnamed reactions toward the total but never tallies them', () => {
    const tallies = new Map<string, ReactionTally>();
    const added = tallyReactions([{ count: 9 }, { name: null, count: 2 }], tallies);
    expect(added).toBe(11);
    expect(tallies.size).toBe(0);
  });
});

describe('topReactionOf', () => {
  it('returns a copy of the most-summed tally', () => {
    const tally: ReactionTally = { name: 'pepe', id: '111', animated: false, count: 7 };
    const tallies = new Map<string, ReactionTally>([
      ['111', tally],
      ['🔥', { name: '🔥', id: null, animated: false, count: 4 }],
    ]);
    const top = topReactionOf(tallies);
    expect(top).toEqual({ name: 'pepe', id: '111', animated: false, count: 7 });
    expect(top).not.toBe(tally); // a copy, not the live tally
  });

  it('returns null when there are no tallies', () => {
    expect(topReactionOf(new Map())).toBeNull();
  });
});
