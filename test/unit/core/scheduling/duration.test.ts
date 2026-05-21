import { describe, expect, it } from 'vitest';

import { parseDuration } from '../../../../src/core/scheduling';

describe('parseDuration', () => {
  it.each([
    ['1s', 1000],
    ['45s', 45_000],
    ['2m', 120_000],
    ['1h', 3_600_000],
    ['3h', 10_800_000],
    ['1d', 86_400_000],
    ['7d', 604_800_000],
    ['1w', 604_800_000],
    ['2w', 1_209_600_000],
    ['0s', 0],
  ])('parses %s into %d ms', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each([
    ['', 'empty string'],
    ['30', 'missing unit'],
    ['m', 'missing count'],
    ['30x', 'unknown unit'],
    ['-5m', 'negative count'],
    ['1.5h', 'fractional count'],
    ['1h30m', 'compound expression'],
    [' 5m', 'leading whitespace'],
    ['5m ', 'trailing whitespace'],
    ['5M', 'uppercase unit'],
  ])('returns null for %s (%s)', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});
