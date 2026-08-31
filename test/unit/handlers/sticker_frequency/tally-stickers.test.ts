/**
 * Unit coverage for the `/sticker_frequency` tally: the month-by-month
 * walk (one query per month, newest month first), the guild-owned-only
 * filter, and the progress callback the handler edits its reply from.
 */
import { describe, expect, it, vi } from 'vitest';

import { tallyStickerUsage } from '../../../../src/handlers/commands/sticker_frequency/tally-stickers';
import { ok } from '../../../../src/core/result';
import { databaseErrorFrom } from '../../../../src/persistence/error-translator';
import type { Repos } from '../../../../src/persistence/repositories';
import type { MessageDoc } from '../../../../src/persistence/schemas/message.schema';

const messageWith = (...stickerNames: string[]): MessageDoc =>
  ({ stickers: stickerNames.map((name) => ({ name })) }) as unknown as MessageDoc;

const DAY_MS = 24 * 60 * 60 * 1000;

interface FakeRepos {
  readonly repos: Pick<Repos, 'message'>;
  /** Every `[startMs, endMs)` the tally asked for, in call order. */
  readonly windows: [number, number][];
}

const reposReturning = (perMonth: ReadonlyArray<readonly MessageDoc[]>): FakeRepos => {
  const windows: [number, number][] = [];
  let call = 0;
  return {
    windows,
    repos: {
      message: {
        findByTimestampRange: vi.fn(async (startMs: number, endMs: number) => {
          windows.push([startMs, endMs]);
          const chunk = perMonth[call] ?? [];
          call += 1;
          return ok(chunk);
        }),
      },
    } as unknown as Pick<Repos, 'message'>,
  };
};

describe('tallyStickerUsage', () => {
  it('counts each guild-owned sticker across every month', async () => {
    const { repos } = reposReturning([
      [messageWith('wave'), messageWith('wave', 'nod')],
      [messageWith('nod')],
    ]);

    const counts = await tallyStickerUsage(repos, ['wave', 'nod'], 2, async () => undefined);

    expect([...counts]).toEqual([
      ['wave', 2],
      ['nod', 2],
    ]);
    expect(repos.message.findByTimestampRange).toHaveBeenCalledTimes(2);
  });

  it('seeds every guild sticker at zero, including unused ones', async () => {
    const counts = await tallyStickerUsage(
      reposReturning([[]]).repos,
      ['unused'],
      1,
      async () => undefined,
    );
    expect(counts.get('unused')).toBe(0);
  });

  it('ignores a sticker the guild no longer owns', async () => {
    const counts = await tallyStickerUsage(
      reposReturning([[messageWith('deleted-sticker')]]).repos,
      ['wave'],
      1,
      async () => undefined,
    );
    expect([...counts]).toEqual([['wave', 0]]);
  });

  it('tolerates messages with no stickers at all', async () => {
    const counts = await tallyStickerUsage(
      reposReturning([[{} as unknown as MessageDoc]]).repos,
      ['wave'],
      1,
      async () => undefined,
    );
    expect(counts.get('wave')).toBe(0);
  });

  it('reports progress once per month, counting up', async () => {
    const progress: number[] = [];

    await tallyStickerUsage(reposReturning([[], [], []]).repos, [], 3, async (done) => {
      progress.push(done);
    });

    expect(progress).toEqual([1, 2, 3]);
  });

  it('queries one non-overlapping month-wide window per step, walking backwards', async () => {
    // Without this the walk's arithmetic is unconstrained: collapsing
    // `getMonth() - monthOffset - 1` to `- monthOffset` yields three
    // zero-width windows and an all-zero tally, which every other
    // assertion here would still accept.
    const { repos, windows } = reposReturning([[], [], []]);

    await tallyStickerUsage(repos, ['wave'], 3, async () => undefined);

    expect(windows).toHaveLength(3);
    for (const [startMs, endMs] of windows) {
      const widthDays = (endMs - startMs) / DAY_MS;
      expect(widthDays).toBeGreaterThan(26);
      expect(widthDays).toBeLessThan(32);
    }
    for (let i = 1; i < windows.length; i += 1) {
      const [prevStart] = windows[i - 1] as [number, number];
      const [start, end] = windows[i] as [number, number];
      // Each step is strictly older than the last and does not overlap
      // it. The 1s slack absorbs the fresh `new Date()` per iteration.
      expect(start).toBeLessThan(prevStart);
      expect(end).toBeLessThanOrEqual(prevStart + 1_000);
    }
  });

  it('re-throws a repo error to the handler error boundary', async () => {
    const boom = databaseErrorFrom(new Error('mongo down'), {
      operation: 'MessageRepo.findByTimestampRange',
    });
    const repos = {
      message: { findByTimestampRange: vi.fn(async () => ({ ok: false, error: boom }) as never) },
    } as unknown as Pick<Repos, 'message'>;

    await expect(tallyStickerUsage(repos, ['wave'], 1, async () => undefined)).rejects.toBe(boom);
  });
});
