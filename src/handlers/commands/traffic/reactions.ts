/**
 * Per-emoji reaction tallying for `/traffic`. Extracted from
 * `aggregation` to keep that file under the 150-line handler cap and to
 * isolate the custom-vs-unicode emoji identity rule: a reaction is keyed
 * by its custom-emoji snowflake when present, else by the unicode
 * character in `name`, so the same name on two different custom emojis
 * never collides.
 */
import type { TopReaction } from './types';

/** The reaction fields the backup persists (see message.schema). */
export interface RawReaction {
  readonly name?: string | null;
  readonly id?: string | null;
  readonly animated?: boolean | null;
  readonly count?: number | null;
}

/** Mutable per-emoji tally folded during aggregation. */
export interface ReactionTally {
  name: string;
  id: string | null;
  animated: boolean;
  count: number;
}

/**
 * Fold one message's reactions into `tallies` (mutated in place) and
 * return the total reaction count added, so the caller can also maintain
 * the grand total. Unnamed reactions are skipped — they cannot be
 * rendered as an emoji.
 */
export const tallyReactions = (
  reactions: readonly RawReaction[],
  tallies: Map<string, ReactionTally>,
): number => {
  let added = 0;
  for (const r of reactions) {
    const count = r.count ?? 0;
    added += count;
    const name = r.name;
    if (!name) continue;
    const id = r.id ?? null;
    const key = id ?? name;
    const existing = tallies.get(key);
    if (existing) existing.count += count;
    else tallies.set(key, { name, id, animated: r.animated ?? false, count });
  }
  return added;
};

/** The most-summed reaction, or null when none were recorded. */
export const topReactionOf = (tallies: ReadonlyMap<string, ReactionTally>): TopReaction | null => {
  let top: ReactionTally | null = null;
  for (const tally of tallies.values()) {
    if (tally.count > 0 && (top === null || tally.count > top.count)) top = tally;
  }
  return top === null ? null : { ...top };
};
