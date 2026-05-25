import { describe, expect, it } from 'vitest';

import { initEmojiCounts } from '../../../../src/handlers/commands/emoji_frequency/aggregate-emoji-counts';
import { rankEmoji } from '../../../../src/handlers/commands/emoji_frequency/rank-emoji';

describe('rankEmoji', () => {
  const setup = () => {
    const counts = initEmojiCounts(['<:a:1>', '<:b:2>', '<a:c:3>']);
    counts.text.set('<:a:1>', 5);
    counts.reaction.set('<:a:1>', 2);
    counts.text.set('<:b:2>', 1);
    counts.text.set('<a:c:3>', 10);
    return counts;
  };

  it('returns only static (<:...>) entries when type is static', () => {
    const ranked = rankEmoji(setup(), { type: 'static', frequency: 'desc', topN: 10 });
    expect(ranked.every((r) => r.emoji.startsWith('<:'))).toBe(true);
    expect(ranked.find((r) => r.emoji.startsWith('<a:'))).toBeUndefined();
  });

  it('returns only animated (<a:...>) entries when type is animated', () => {
    const ranked = rankEmoji(setup(), { type: 'animated', frequency: 'desc', topN: 10 });
    expect(ranked.every((r) => r.emoji.startsWith('<a:'))).toBe(true);
  });

  it('sorts descending and caps to topN', () => {
    const ranked = rankEmoji(setup(), { type: 'static', frequency: 'desc', topN: 1 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.emoji).toBe('<:a:1>');
    expect(ranked[0]?.total).toBe(7);
  });

  it('sorts ascending when frequency is asc', () => {
    const ranked = rankEmoji(setup(), { type: 'static', frequency: 'asc', topN: 10 });
    expect(ranked[0]?.emoji).toBe('<:b:2>');
  });
});
