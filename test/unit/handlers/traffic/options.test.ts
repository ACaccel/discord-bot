/**
 * Unit coverage for `/traffic` option parsing: defaults, choice
 * passthrough, top_n clamping, and fallback on out-of-range values.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { readTrafficOptions } from '../../../../src/handlers/commands/traffic/options';

const interactionWith = (
  values: Record<string, string | number>,
): Pick<ChatInputCommandInteraction, 'options'> =>
  ({
    options: { get: (name: string) => (name in values ? { value: values[name] } : null) },
  }) as unknown as Pick<ChatInputCommandInteraction, 'options'>;

describe('readTrafficOptions', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(readTrafficOptions(interactionWith({}))).toEqual({
      visibility: 'ephemeral',
      range: '7d',
      topN: 10,
    });
  });

  it('passes through valid choices', () => {
    expect(
      readTrafficOptions(interactionWith({ visibility: 'public', range: '30d', top_n: 5 })),
    ).toEqual({ visibility: 'public', range: '30d', topN: 5 });
  });

  it('clamps top_n to [1, 25] and floors fractions', () => {
    expect(readTrafficOptions(interactionWith({ top_n: 100 })).topN).toBe(25);
    expect(readTrafficOptions(interactionWith({ top_n: 0 })).topN).toBe(1);
    expect(readTrafficOptions(interactionWith({ top_n: 7.9 })).topN).toBe(7);
  });

  it('falls back to defaults for unknown choice values', () => {
    const parsed = readTrafficOptions(interactionWith({ visibility: 'bogus', range: '1y' }));
    expect(parsed.visibility).toBe('ephemeral');
    expect(parsed.range).toBe('7d');
  });
});
