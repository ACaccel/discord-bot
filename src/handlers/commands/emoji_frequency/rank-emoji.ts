import type { EmojiCounts } from './aggregate-emoji-counts';

/**
 * Per-emoji leaderboard row. The breakdown into text vs reaction
 * usage is part of the rendered output, so we keep both alongside
 * the total even after sorting.
 */
export interface RankedEmoji {
  readonly emoji: string;
  readonly total: number;
  readonly text: number;
  readonly reaction: number;
}

export interface RankOptions {
  readonly type: 'animated' | 'static';
  readonly frequency: 'asc' | 'desc';
  readonly topN: number;
}

export const rankEmoji = (counts: EmojiCounts, opts: RankOptions): RankedEmoji[] => {
  const prefix = opts.type === 'animated' ? '<a:' : '<:';
  const rows: RankedEmoji[] = [];
  for (const [emoji, textCount] of counts.text) {
    if (!emoji.startsWith(prefix)) continue;
    const reactionCount = counts.reaction.get(emoji) ?? 0;
    rows.push({
      emoji,
      total: textCount + reactionCount,
      text: textCount,
      reaction: reactionCount,
    });
  }
  rows.sort((a, b) => (opts.frequency === 'asc' ? a.total - b.total : b.total - a.total));
  return rows.slice(0, opts.topN);
};
