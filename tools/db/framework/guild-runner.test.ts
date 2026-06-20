/**
 * Unit suite for the per-guild runner's failure isolation. Uses a silent
 * real logger so no output is produced and no fake needs maintaining.
 */
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../../src/core/logger';

import { runPerGuild } from './guild-runner';

const silentLogger = createLogger({ level: 'silent', pretty: false });

describe('db / runPerGuild', () => {
  it('isolates a single guild failure and preserves input order', async () => {
    const outcomes = await runPerGuild(
      ['1', '2', '3'],
      async (guildId) => {
        if (guildId === '2') throw new Error('boom');
        return `ok-${guildId}`;
      },
      silentLogger,
      'test',
    );
    expect(outcomes).toEqual([
      { guildId: '1', ok: true, result: 'ok-1', error: null },
      { guildId: '2', ok: false, result: null, error: 'boom' },
      { guildId: '3', ok: true, result: 'ok-3', error: null },
    ]);
  });

  it('stringifies a non-Error throw into the outcome', async () => {
    const outcomes = await runPerGuild(
      ['9'],
      async () => {
        throw 'plain string failure';
      },
      silentLogger,
      'test',
    );
    expect(outcomes).toEqual([
      { guildId: '9', ok: false, result: null, error: 'plain string failure' },
    ]);
  });

  it('returns an empty array for no guilds', async () => {
    const outcomes = await runPerGuild([], async () => 'unused', silentLogger, 'test');
    expect(outcomes).toEqual([]);
  });
});
