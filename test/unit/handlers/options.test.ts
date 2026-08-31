/**
 * Typed slash-command option accessors.
 *
 * The pattern these replace — `interaction.options.get('x')?.value as
 * string` — types a missing option as a present `string`, so the
 * failure surfaced far from the cast (a `.trim()` on `undefined`, or a
 * query built with the literal text `undefined`).
 */
import { describe, expect, it } from 'vitest';

import {
  getOptionalChoice,
  getOptionalNumber,
  getOptionalString,
  getRequiredNumber,
  getRequiredString,
  type OptionSource,
} from '../../../src/infra/discord/options';

const source = (values: Record<string, unknown>): OptionSource => ({
  options: {
    get: (name: string) =>
      name in values
        ? ({ value: values[name] } as ReturnType<OptionSource['options']['get']>)
        : null,
  },
});

describe('required option accessors', () => {
  it('returns the value when present and correctly typed', () => {
    expect(getRequiredString(source({ action: 'start' }), 'action')).toBe('start');
    expect(getRequiredNumber(source({ duration: 5 }), 'duration')).toBe(5);
  });

  it('throws a TypeError naming the option when it is absent', () => {
    expect(() => getRequiredString(source({}), 'action')).toThrow(TypeError);
    expect(() => getRequiredString(source({}), 'action')).toThrow(/"action"/);
  });

  it('throws a TypeError when the value has the wrong primitive type', () => {
    expect(() => getRequiredNumber(source({ duration: '5' }), 'duration')).toThrow(TypeError);
    expect(() => getRequiredString(source({ action: 7 }), 'action')).toThrow(TypeError);
  });

  it('accepts falsy-but-valid values', () => {
    expect(getRequiredString(source({ text: '' }), 'text')).toBe('');
    expect(getRequiredNumber(source({ count: 0 }), 'count')).toBe(0);
  });
});

describe('optional option accessors', () => {
  it('returns undefined when the option is absent', () => {
    expect(getOptionalString(source({}), 'type')).toBeUndefined();
    expect(getOptionalNumber(source({}), 'budget')).toBeUndefined();
  });

  it('returns undefined rather than a coerced value on a type mismatch', () => {
    expect(getOptionalNumber(source({ budget: '500' }), 'budget')).toBeUndefined();
    expect(getOptionalString(source({ type: 3 }), 'type')).toBeUndefined();
  });

  it('passes through a present value of the right type', () => {
    expect(getOptionalString(source({ type: 'ramen' }), 'type')).toBe('ramen');
    expect(getOptionalNumber(source({ budget: 500 }), 'budget')).toBe(500);
  });
});

describe('getOptionalChoice', () => {
  const DIRECTIONS = ['asc', 'desc'] as const;

  it('returns a value that is one of the choices', () => {
    expect(getOptionalChoice(source({ frequency: 'desc' }), 'frequency', DIRECTIONS, 'asc')).toBe(
      'desc',
    );
  });

  it('falls back when the option is absent', () => {
    expect(getOptionalChoice(source({}), 'frequency', DIRECTIONS, 'asc')).toBe('asc');
  });

  it('falls back on a value outside the choice set', () => {
    // The `as 'asc' | 'desc'` assertion this replaces produced a value
    // the type said was impossible.
    expect(
      getOptionalChoice(source({ frequency: 'sideways' }), 'frequency', DIRECTIONS, 'asc'),
    ).toBe('asc');
  });
});
