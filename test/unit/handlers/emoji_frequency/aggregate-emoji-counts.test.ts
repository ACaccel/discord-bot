import { describe, expect, it } from 'vitest';

import {
  accumulateEmojiCounts,
  initEmojiCounts,
} from '../../../../src/handlers/commands/emoji_frequency/aggregate-emoji-counts';

describe('initEmojiCounts', () => {
  it('seeds both maps with the supplied emojis at zero', () => {
    const counts = initEmojiCounts(['<:foo:1>', '<a:bar:2>']);
    expect(counts.text.get('<:foo:1>')).toBe(0);
    expect(counts.reaction.get('<a:bar:2>')).toBe(0);
    expect(counts.text.size).toBe(2);
  });
});

describe('accumulateEmojiCounts', () => {
  it('counts inline text emoji occurrences', () => {
    const counts = initEmojiCounts(['<:foo:1>']);
    accumulateEmojiCounts(
      [{ content: 'hello <:foo:1> world <:foo:1>' }, { content: '<:foo:1>' }],
      counts,
    );
    expect(counts.text.get('<:foo:1>')).toBe(3);
  });

  it('sums reaction counts by emoji', () => {
    const counts = initEmojiCounts(['<:bar:2>']);
    accumulateEmojiCounts(
      [
        { reactions: [{ id: '2', name: 'bar', animated: false, count: 3 }] },
        { reactions: [{ id: '2', name: 'bar', animated: false, count: 4 }] },
      ],
      counts,
    );
    expect(counts.reaction.get('<:bar:2>')).toBe(7);
  });

  it('ignores emojis that were not seeded', () => {
    const counts = initEmojiCounts(['<:known:1>']);
    accumulateEmojiCounts([{ content: '<:unknown:9>' }], counts);
    expect(counts.text.get('<:unknown:9>')).toBeUndefined();
    expect(counts.text.get('<:known:1>')).toBe(0);
  });
});
