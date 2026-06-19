/**
 * Unit coverage for the shared per-user traffic option parsing
 * (`/traffic_me`, `/traffic_user`): defaults, the `visibility` choice
 * (mirroring `/traffic`), range passthrough / fallback, and top_n clamping.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { readTrafficStatsOptions } from '../../../../src/handlers/commands/traffic-shared/options';

const interactionWith = (
  values: Record<string, string | number>,
): Pick<ChatInputCommandInteraction, 'options'> =>
  ({
    options: { get: (name: string) => (name in values ? { value: values[name] } : null) },
  }) as unknown as Pick<ChatInputCommandInteraction, 'options'>;

describe('readTrafficStatsOptions', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(readTrafficStatsOptions(interactionWith({}))).toEqual({
      visibility: 'ephemeral',
      range: '7d',
      topN: 10,
    });
  });

  it('passes a valid visibility / range and clamps top_n', () => {
    expect(
      readTrafficStatsOptions(interactionWith({ visibility: 'public', range: '24h', top_n: 99 })),
    ).toEqual({
      visibility: 'public',
      range: '24h',
      topN: 25,
    });
    expect(readTrafficStatsOptions(interactionWith({ top_n: 0 })).topN).toBe(1);
  });

  it('falls back to defaults for unknown visibility / range values', () => {
    expect(readTrafficStatsOptions(interactionWith({ visibility: 'secret' })).visibility).toBe(
      'ephemeral',
    );
    expect(readTrafficStatsOptions(interactionWith({ range: '1y' })).range).toBe('7d');
  });
});
