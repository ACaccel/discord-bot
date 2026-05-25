import { describe, expect, it } from 'vitest';

import { parseIds } from '../../../../src/handlers/commands/inspect_member_ids/parse-ids';

describe('parseIds', () => {
  it('returns an empty array when no snowflake-shaped numbers are present', () => {
    expect(parseIds('hello world')).toEqual([]);
  });

  it('extracts 17-20 digit numbers and preserves first-seen order', () => {
    const raw = 'a 12345678901234567 b 98765432109876543210 c 12345678901234567';
    expect(parseIds(raw)).toEqual(['12345678901234567', '98765432109876543210']);
  });

  it('ignores numbers shorter than 17 digits', () => {
    expect(parseIds('1234567890123456 1234567890123456789')).toEqual(['1234567890123456789']);
  });

  it('deduplicates repeated IDs', () => {
    expect(parseIds('11111111111111111 11111111111111111')).toEqual(['11111111111111111']);
  });
});
