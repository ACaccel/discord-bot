import { describe, expect, it } from 'vitest';

import {
  formatLeaderboard,
  type TFn,
} from '../../../../src/handlers/commands/emoji_frequency/format-leaderboard';
import type { RankedEmoji } from '../../../../src/handlers/commands/emoji_frequency/rank-emoji';

const t: TFn = (key) => `[${key}]`;

const makeRanked = (n: number): RankedEmoji[] =>
  Array.from({ length: n }, (_, i) => ({
    emoji: `<:e${i}:${i}>`,
    total: n - i,
    text: n - i,
    reaction: 0,
  }));

describe('formatLeaderboard', () => {
  it('returns an empty array when no emojis are supplied', () => {
    expect(formatLeaderboard([], { months: 1, direction: 'd', topN: 5, kind: 'k' }, t)).toEqual([]);
  });

  it('keeps a single page when ranked length is at or under pageSize', () => {
    const pages = formatLeaderboard(
      makeRanked(5),
      { months: 1, direction: 'd', topN: 5, kind: 'k', pageSize: 10 },
      t,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('[replies:emoji_frequency.header]');
  });

  it('splits into multiple pages when ranked length exceeds pageSize', () => {
    const pages = formatLeaderboard(
      makeRanked(25),
      { months: 1, direction: 'd', topN: 25, kind: 'k', pageSize: 10 },
      t,
    );
    expect(pages).toHaveLength(3);
    // Only the first page carries the header line.
    expect(pages[0]).toContain('[replies:emoji_frequency.header]');
    expect(pages[1]).not.toContain('[replies:emoji_frequency.header]');
  });
});
