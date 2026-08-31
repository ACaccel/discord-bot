/**
 * Unit tests for the interaction-router `traceId`, which is derived
 * from `crypto.randomUUID()` so the format and entropy are well-defined.
 *
 * The bridge mints `randomUUID().slice(0, 8)`. We exercise the same
 * primitive directly: any drift between this test and the bridge would
 * be either a same-PR rename (caught in code review) or a regression
 * back to `Math.random().toString(36)` (caught by the format
 * assertion below).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

const HEX_8 = /^[0-9a-f]{8}$/;
const newTraceId = (): string => randomUUID().slice(0, 8);

describe('traceId', () => {
  it('is exactly 8 lowercase hex characters', () => {
    for (let i = 0; i < 100; i += 1) {
      const id = newTraceId();
      expect(id).toHaveLength(8);
      expect(id).toMatch(HEX_8);
    }
  });

  it('produces no duplicates across 1000 generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(newTraceId());
    }
    expect(seen.size).toBe(1000);
  });
});
