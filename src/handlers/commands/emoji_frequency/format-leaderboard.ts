import type { RankedEmoji } from './rank-emoji';

/**
 * Translator function signature compatible with `bot.translator.t`.
 */
export type TFn = (key: string, params?: Record<string, string | number>) => string;

interface FormatLeaderboardOptions {
  readonly months: number;
  readonly direction: string;
  readonly topN: number;
  readonly kind: string;
  readonly pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Split the ranked emoji list into Discord-sendable pages. The header
 * line lives on the first page; every page after that is pure ranking
 * rows so each follow-up message stays self-contained.
 */
export const formatLeaderboard = (
  ranked: ReadonlyArray<RankedEmoji>,
  opts: FormatLeaderboardOptions,
  t: TFn,
): string[] => {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  if (ranked.length === 0) return [];

  const pages: string[] = [];
  const header = t('replies:emoji_frequency.header', {
    months: opts.months,
    direction: opts.direction,
    top: opts.topN,
    kind: opts.kind,
  });
  let current = header;

  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i] as RankedEmoji;
    current += t('replies:emoji_frequency.line', {
      rank: i + 1,
      emoji: row.emoji,
      total: row.total,
      text: row.text,
      reaction: row.reaction,
    });
    if ((i + 1) % pageSize === 0 || i === ranked.length - 1) {
      pages.push(current);
      current = '';
    }
  }
  return pages;
};
