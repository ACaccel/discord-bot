/**
 * Month-by-month sticker tally for `/sticker_frequency`.
 *
 * Split out of `index.ts` (150-line cap). The window is walked one month
 * at a time rather than fetched whole: a guild's full message history
 * does not fit in the heap, and the caller reports progress between
 * months so a long scan does not look hung. Only stickers the guild
 * still owns are counted — a name absent from `stickerNames` belongs to
 * a deleted sticker and has nothing to render.
 *
 * A repo `err` is re-thrown to the handler's error boundary.
 */
import type { Repos } from '../../../persistence/repositories';

export const tallyStickerUsage = async (
  repos: Pick<Repos, 'message'>,
  stickerNames: Iterable<string>,
  months: number,
  onMonthDone: (monthsDone: number) => Promise<void>,
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const name of stickerNames) counts.set(name, 0);

  for (let monthOffset = 0; monthOffset < months; monthOffset++) {
    const monthStart = new Date();
    monthStart.setMonth(monthStart.getMonth() - monthOffset - 1);
    const monthEnd = new Date();
    monthEnd.setMonth(monthEnd.getMonth() - monthOffset);

    const messagesResult = await repos.message.findByTimestampRange(
      monthStart.getTime(),
      monthEnd.getTime(),
    );
    if (!messagesResult.ok) throw messagesResult.error;

    for (const message of messagesResult.value) {
      for (const sticker of message.stickers ?? []) {
        const name = sticker.name;
        if (typeof name === 'string' && counts.has(name)) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }

    await onMonthDone(monthOffset + 1);
  }

  return counts;
};
