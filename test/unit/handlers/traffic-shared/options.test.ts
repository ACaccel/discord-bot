/**
 * Unit coverage for the option parsing the whole `/traffic` family
 * shares (`/traffic`, `/traffic_me`, `/traffic_user`): defaults, the
 * `visibility` choice, range passthrough / fallback, and `top_n`
 * clamping in both directions plus its floor.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { readTrafficOptions } from '../../../../src/handlers/commands/traffic-shared/options';

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

  it('passes a valid visibility / range and clamps top_n', () => {
    expect(
      readTrafficOptions(interactionWith({ visibility: 'public', range: '24h', top_n: 99 })),
    ).toEqual({
      visibility: 'public',
      range: '24h',
      topN: 25,
    });
    expect(readTrafficOptions(interactionWith({ top_n: 0 })).topN).toBe(1);
    // Discord's number option admits decimals; the chart takes a count.
    expect(readTrafficOptions(interactionWith({ top_n: 7.9 })).topN).toBe(7);
  });

  it('falls back to defaults for unknown visibility / range values', () => {
    expect(readTrafficOptions(interactionWith({ visibility: 'secret' })).visibility).toBe(
      'ephemeral',
    );
    expect(readTrafficOptions(interactionWith({ range: '1y' })).range).toBe('7d');
  });
});
