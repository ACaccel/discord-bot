/**
 * Unit coverage for {@link requireCapture}: the happy path returns the
 * capture, an empty capture is a legitimate value (not an absence), and
 * a group that did not participate raises rather than yielding
 * `undefined` — the whole point of routing capture reads through it.
 */
import { describe, expect, it } from 'vitest';

import { requireCapture } from '../../../src/core/regex-capture';

const matchOf = (pattern: RegExp, input: string): RegExpMatchArray => {
  const match = pattern.exec(input);
  if (match === null) throw new Error(`fixture did not match: ${input}`);
  return match;
};

describe('requireCapture', () => {
  it('returns a mandatory group', () => {
    const match = matchOf(/^(\d+)d(\d+)$/, '3d6');
    expect(requireCapture(match, 1)).toBe('3');
    expect(requireCapture(match, 2)).toBe('6');
  });

  it('returns the whole match for group 0', () => {
    expect(requireCapture(matchOf(/<@&(\d+)>/, '<@&42>'), 0)).toBe('<@&42>');
  });

  it('returns an empty capture as the empty string', () => {
    expect(requireCapture(matchOf(/^a(x*)b$/, 'ab'), 1)).toBe('');
  });

  it('throws when an optional group did not participate', () => {
    const match = matchOf(/^a(x)?b$/, 'ab');
    expect(() => requireCapture(match, 1)).toThrow(TypeError);
  });

  it('throws when the group index is past the pattern', () => {
    expect(() => requireCapture(matchOf(/^(a)$/, 'a'), 2)).toThrow(TypeError);
  });
});
