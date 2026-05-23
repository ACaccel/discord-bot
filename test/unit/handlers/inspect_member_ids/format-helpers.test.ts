import { describe, expect, it } from 'vitest';

import {
  fmtTimestamp,
  toText,
  truncate,
} from '../../../../src/handlers/commands/inspect_member_ids/format-helpers';

describe('fmtTimestamp', () => {
  it('returns "N/A" for null or undefined dates', () => {
    expect(fmtTimestamp(null)).toBe('N/A');
    expect(fmtTimestamp(undefined)).toBe('N/A');
  });

  it('formats a Date as the absolute + relative Discord timestamp pair', () => {
    const date = new Date('2026-05-23T10:00:00Z');
    const unix = Math.floor(date.getTime() / 1000);
    expect(fmtTimestamp(date)).toBe(`<t:${unix}:F> (<t:${unix}:R>)`);
  });
});

describe('toText', () => {
  it('returns "N/A" for null, undefined, or blank strings', () => {
    expect(toText(null)).toBe('N/A');
    expect(toText(undefined)).toBe('N/A');
    expect(toText('   ')).toBe('N/A');
  });

  it('stringifies other values as-is', () => {
    expect(toText('hello')).toBe('hello');
    expect(toText(42)).toBe('42');
  });
});

describe('truncate', () => {
  it('returns the text unchanged when within the cap', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('truncates with an ellipsis when over the cap, keeping total length = max', () => {
    const result = truncate('1234567890', 5);
    expect(result).toBe('12...');
    expect(result).toHaveLength(5);
  });
});
