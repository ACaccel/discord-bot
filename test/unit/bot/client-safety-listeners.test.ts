import { EventEmitter } from 'node:events';

import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { installClientSafetyListeners } from '../../../src/bot/client-safety-listeners';
import type { Logger } from '../../../src/core/logger';

/**
 * A bare EventEmitter stands in for the discord.js `Client`: both throw
 * an emitted `'error'` with no listener, which is exactly the behaviour
 * the safety net must neutralise.
 */
const buildClient = (): EventEmitter => new EventEmitter();

const buildLogger = (): {
  logger: Logger;
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} => {
  const error = vi.fn();
  const warn = vi.fn();
  return { logger: { error, warn } as unknown as Logger, error, warn };
};

describe('installClientSafetyListeners', () => {
  it('swallows a client "error" emission and logs it instead of throwing', () => {
    const client = buildClient();
    const { logger, error } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    expect(() => client.emit('error', new Error('socket hang up'))).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('logs a shardError at error level with the shard id', () => {
    const client = buildClient();
    const { logger, error } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    client.emit('shardError', new Error('reset'), 0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatchObject({ shardId: 0 });
  });

  it('logs a shardDisconnect at warn level', () => {
    const client = buildClient();
    const { logger, warn } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    client.emit('shardDisconnect', { code: 1006, reason: 'abnormal' }, 0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ shardId: 0, code: 1006 });
  });
});
