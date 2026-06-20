/**
 * Unit suite for the `verify` command. Covers the pure check table and
 * the single-guild contract; the Mongo-touching paths are exercised only
 * through manual runs against a real cluster.
 */
import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../../src/core/errors/configuration-error';
import { createLogger } from '../../../src/core/logger';
import type { DbRunContext } from '../framework/command';

import { FILTER_CHECKS, verifyCommand } from './verify';

const silentLogger = createLogger({ level: 'silent', pretty: false });

/** A run context whose connection helper fails if ever invoked. */
const ctxWithGuilds = (guilds: readonly string[]): DbRunContext => ({
  shared: { mongoUri: 'mongodb://h/', guilds, outputPath: null },
  logger: silentLogger,
  withGuildConnection: async () => {
    throw new Error('verify must not open a connection when the guild count is invalid');
  },
});

describe('verify / FILTER_CHECKS', () => {
  it('declares the filter checks in order with their expected filters', () => {
    expect(FILTER_CHECKS.map((c) => c.name)).toEqual([
      'messageId-null',
      'messageId-empty-string',
      'channelId-missing',
      'userId-missing',
      'userName-missing',
      'timestamp-invalid',
    ]);
    expect(FILTER_CHECKS[0]?.filter).toEqual({ messageId: null });
    expect(FILTER_CHECKS[1]?.filter).toEqual({ messageId: '' });
    expect(FILTER_CHECKS[5]?.filter).toEqual({
      $or: [{ timestamp: { $not: { $type: 'number' } } }, { timestamp: { $lte: 0 } }],
    });
  });
});

describe('verify / single-guild contract', () => {
  it('exposes the expected command metadata', () => {
    expect(verifyCommand.name).toBe('verify');
  });

  it('rejects a multi-guild config before opening any connection', async () => {
    await expect(verifyCommand.execute({}, ctxWithGuilds(['1', '2']))).rejects.toThrow(
      ConfigurationError,
    );
  });

  it('rejects an empty guild list', async () => {
    await expect(verifyCommand.execute({}, ctxWithGuilds([]))).rejects.toThrow(ConfigurationError);
  });
});
