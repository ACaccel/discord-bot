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
  info: ReturnType<typeof vi.fn>;
} => {
  const error = vi.fn();
  const warn = vi.fn();
  const info = vi.fn();
  return { logger: { error, warn, info } as unknown as Logger, error, warn, info };
};

describe('installClientSafetyListeners', () => {
  it('swallows a client "error" emission and logs it at warn instead of throwing', () => {
    const client = buildClient();
    const { logger, error, warn } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    expect(() => client.emit('error', new Error('socket hang up'))).not.toThrow();
    // A self-healing network blip is not a defect and must not trip an
    // alert keyed on the error level.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a shardError at warn level with the shard id', () => {
    const client = buildClient();
    const { logger, error, warn } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    client.emit('shardError', new Error('getaddrinfo ENOTFOUND gateway.discord.gg'), 0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ shardId: 0 });
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a shardDisconnect at warn level', () => {
    const client = buildClient();
    const { logger, warn } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    client.emit('shardDisconnect', { code: 1006, reason: 'abnormal' }, 0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ shardId: 0, code: 1006 });
  });

  it('logs shardReconnecting at info level', () => {
    const client = buildClient();
    const { logger, info } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    client.emit('shardReconnecting', 0);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toMatchObject({ shardId: 0 });
  });

  it('logs shardResume at info level with the replayed event count', () => {
    const client = buildClient();
    const { logger, info } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    client.emit('shardResume', 0, 12);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toMatchObject({ shardId: 0, replayedEvents: 12 });
  });

  it('logs shardReady at info level with the unavailable-guild count', () => {
    const client = buildClient();
    const { logger, info } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    client.emit('shardReady', 0, new Set(['1', '2']));
    client.emit('shardReady', 1, undefined);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[0]?.[0]).toMatchObject({ shardId: 0, unavailableGuilds: 2 });
    expect(info.mock.calls[1]?.[0]).toMatchObject({ shardId: 1, unavailableGuilds: 0 });
  });

  it('is idempotent for the same client', () => {
    const client = buildClient();
    const { logger, warn } = buildLogger();
    installClientSafetyListeners({ client: client as unknown as Client, logger });
    installClientSafetyListeners({ client: client as unknown as Client, logger });

    client.emit('error', new Error('socket hang up'));

    // A repeated install used to double every connection-error line and
    // walk the emitter towards Node's max-listeners warning.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(client.listenerCount('error')).toBe(1);
  });

  it('still installs on a different client', () => {
    const first = buildClient();
    const second = buildClient();
    const { logger, warn } = buildLogger();
    installClientSafetyListeners({ client: first as unknown as Client, logger });
    installClientSafetyListeners({ client: second as unknown as Client, logger });

    second.emit('error', new Error('socket hang up'));

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
