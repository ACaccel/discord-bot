/**
 * Cross-window volume comparison for `/traffic`. The trend field needs
 * the previous equal-length window's visible message count, so it lives
 * apart from the single-window `aggregation` accumulator. The same
 * privacy `allowed` set is applied to the previous window, so the
 * comparison never counts a channel the invoker cannot see.
 */
import type { Repos } from '../../../persistence/repositories';

import { DAY_MS } from '../traffic-shared/window';

/**
 * Volume comparison against the immediately preceding equal-length
 * window. `percentChange` is `null` when the previous window held no
 * visible messages (no baseline to grow from).
 */
export interface TrafficTrend {
  readonly previousTotal: number;
  readonly percentChange: number | null;
}

/**
 * Count visible messages in `[startMs, endMs)`, fetched a day at a time
 * to mirror `aggregateTraffic`'s chunked memory discipline. A repo error
 * is re-thrown to the handler boundary (`replyForError`).
 */
export const countTrafficMessages = async (
  repos: Pick<Repos, 'message'>,
  startMs: number,
  endMs: number,
  allowed: ReadonlySet<string>,
): Promise<number> => {
  let total = 0;
  for (let chunkStart = startMs; chunkStart < endMs; chunkStart += DAY_MS) {
    const chunkEnd = Math.min(chunkStart + DAY_MS, endMs);
    const result = await repos.message.findByTimestampRange(chunkStart, chunkEnd);
    if (!result.ok) throw result.error;
    for (const m of result.value) if (allowed.has(m.channelId)) total++;
  }
  return total;
};

/**
 * Percentage change of the current window's total against the previous
 * window. `percentChange` is `null` when the previous window was empty
 * — there is no baseline to express growth against.
 */
export const computeTrend = (currentTotal: number, previousTotal: number): TrafficTrend => ({
  previousTotal,
  percentChange:
    previousTotal === 0 ? null : ((currentTotal - previousTotal) / previousTotal) * 100,
});
