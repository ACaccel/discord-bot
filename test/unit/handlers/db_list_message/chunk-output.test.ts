import { describe, expect, it } from 'vitest';

import { chunkLines } from '../../../../src/handlers/commands/db_list_message/chunk-output';

describe('chunkLines', () => {
  it('returns an empty array when given no lines', () => {
    expect(chunkLines([])).toEqual([]);
  });

  it('returns a single chunk when total length is under the limit', () => {
    const chunks = chunkLines(['hello', 'world'], 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('hello\nworld');
  });

  it('splits into multiple chunks when total length exceeds the limit', () => {
    const long = 'x'.repeat(50);
    const chunks = chunkLines([long, long, long], 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(60);
    }
  });

  it('preserves line order across chunks', () => {
    const long = 'x'.repeat(50);
    const chunks = chunkLines([`${long}a`, `${long}b`, `${long}c`], 60);
    expect(chunks.join('|')).toContain('a');
    expect(chunks.join('|')).toContain('c');
  });
});
