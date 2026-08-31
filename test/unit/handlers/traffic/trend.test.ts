/**
 * Unit coverage for the `/traffic` cross-window trend: the day-chunked
 * `countTrafficMessages` honours the privacy `allowed` set and the
 * `[start, end)` boundary, and `computeTrend` yields a signed percentage
 * or null when the previous window had no baseline.
 */
import { describe, expect, it } from 'vitest';

import { ok } from '../../../../src/core/result';
import {
  computeTrend,
  countTrafficMessages,
} from '../../../../src/handlers/commands/traffic/trend';
import type { Repos } from '../../../../src/persistence/repositories';
import type { MessageDoc } from '../../../../src/persistence/schemas/message.schema';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

const doc = (timestamp: number, channelId: string): MessageDoc =>
  ({ channelId, timestamp }) as unknown as MessageDoc;

const fakeRepo = (docs: readonly MessageDoc[]): Pick<Repos, 'message'> =>
  ({
    message: {
      findByTimestampRange: async (start: number, end: number) =>
        ok(docs.filter((d) => d.timestamp >= start && d.timestamp < end)),
    },
  }) as unknown as Pick<Repos, 'message'>;

describe('countTrafficMessages', () => {
  it('counts only allowed channels within the half-open window', async () => {
    const docs = [
      doc(NOW - 3 * DAY, 'pub'),
      doc(NOW - 2 * DAY, 'pub'),
      doc(NOW - 2 * DAY, 'secret'), // disallowed
      doc(NOW + DAY, 'pub'), // outside the window
    ];
    const total = await countTrafficMessages(fakeRepo(docs), NOW - 7 * DAY, NOW, new Set(['pub']));
    expect(total).toBe(2);
  });

  it('re-throws a repo error to the caller', async () => {
    const failing = {
      message: { findByTimestampRange: async () => ({ ok: false, error: new Error('boom') }) },
    } as unknown as Pick<Repos, 'message'>;
    await expect(countTrafficMessages(failing, NOW - DAY, NOW, new Set())).rejects.toThrow('boom');
  });
});

describe('computeTrend', () => {
  it('reports growth and decline as a signed percentage', () => {
    expect(computeTrend(120, 100)).toEqual({ previousTotal: 100, percentChange: 20 });
    expect(computeTrend(80, 100)).toEqual({ previousTotal: 100, percentChange: -20 });
  });

  it('yields a null percentage when the previous window was empty', () => {
    expect(computeTrend(50, 0)).toEqual({ previousTotal: 0, percentChange: null });
  });
});
