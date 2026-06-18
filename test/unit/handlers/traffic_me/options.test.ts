/**
 * Unit coverage for `/traffic_me` option parsing: defaults, the
 * `visibility` choice (mirroring `/traffic`), range passthrough /
 * fallback, and top_n clamping.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { readTrafficMeOptions } from '../../../../src/handlers/commands/traffic_me/options';

const interactionWith = (
  values: Record<string, string | number>,
): Pick<ChatInputCommandInteraction, 'options'> =>
  ({
    options: { get: (name: string) => (name in values ? { value: values[name] } : null) },
  }) as unknown as Pick<ChatInputCommandInteraction, 'options'>;

describe('readTrafficMeOptions', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(readTrafficMeOptions(interactionWith({}))).toEqual({
      visibility: 'ephemeral',
      range: '7d',
      topN: 10,
    });
  });

  it('passes a valid visibility / range and clamps top_n', () => {
    expect(
      readTrafficMeOptions(interactionWith({ visibility: 'public', range: '24h', top_n: 99 })),
    ).toEqual({
      visibility: 'public',
      range: '24h',
      topN: 25,
    });
    expect(readTrafficMeOptions(interactionWith({ top_n: 0 })).topN).toBe(1);
  });

  it('falls back to defaults for unknown visibility / range values', () => {
    expect(readTrafficMeOptions(interactionWith({ visibility: 'secret' })).visibility).toBe(
      'ephemeral',
    );
    expect(readTrafficMeOptions(interactionWith({ range: '1y' })).range).toBe('7d');
  });
});
