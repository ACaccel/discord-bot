import { describe, expect, it, vi, beforeEach } from 'vitest';

import { logError, logGuildEvent, logSystem } from '../../../../src/core/logger';
import type { Logger } from '../../../../src/core/logger';

interface FakeLogger {
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
}

const makeFake = (): FakeLogger => {
  const fake: FakeLogger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    child: vi.fn((): FakeLogger => fake),
  };
  return fake;
};

describe('logError', () => {
  let fake: FakeLogger;
  beforeEach(() => {
    fake = makeFake();
  });

  it('no-ops when logger is undefined (pre-run() window)', () => {
    expect(() => logError(undefined, 'g-1', new Error('boom'))).not.toThrow();
  });

  it('does not call child when guildId is null/undefined/empty (bot is ambient via base bindings)', () => {
    logError(fake as unknown as Logger, null, new Error('x'));
    expect(fake.child).not.toHaveBeenCalled();
    expect(fake.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'errorLogger');

    fake.child.mockClear();
    fake.error.mockClear();
    logError(fake as unknown as Logger, '', new Error('x'));
    expect(fake.child).not.toHaveBeenCalled();
    expect(fake.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'errorLogger');
  });

  it('binds only guildId when present (bot is ambient via base bindings)', () => {
    logError(fake as unknown as Logger, 'g-1', new Error('x'));
    expect(fake.child).toHaveBeenCalledWith({ guildId: 'g-1' });
  });

  it('uses `err` key for Error instances and `raw` for primitives', () => {
    const err = new Error('boom');
    logError(fake as unknown as Logger, 'g-1', err);
    expect(fake.error).toHaveBeenCalledWith({ err }, 'errorLogger');

    fake.error.mockClear();
    logError(fake as unknown as Logger, 'g-1', 'string-error');
    expect(fake.error).toHaveBeenCalledWith({ raw: 'string-error' }, 'errorLogger');
  });
});

describe('logSystem', () => {
  it('no-ops when logger is undefined', () => {
    expect(() => logSystem(undefined, 'hi')).not.toThrow();
  });

  it('emits msg as the pino headline without rebinding bot (ambient via base bindings)', () => {
    const fake = makeFake();
    logSystem(fake as unknown as Logger, 'hello');
    expect(fake.child).not.toHaveBeenCalled();
    // The headline must be passed positionally — the old shape
    // `{ msg }` collided with pino's `messageKey` default and silently
    // dropped the headline. See helpers.ts comment.
    expect(fake.info).toHaveBeenCalledWith('hello');
  });
});

describe('logGuildEvent', () => {
  it('binds guild/name (bot is ambient) and splats structured details onto the record', () => {
    const fake = makeFake();
    logGuildEvent(
      fake as unknown as Logger,
      'g-1',
      'interaction_create',
      { command: '/talk', user: 'DCaccel', channel: 'general' },
      'GuildName',
    );
    expect(fake.child).toHaveBeenCalledWith({
      guildId: 'g-1',
      guildName: 'GuildName',
    });
    expect(fake.info).toHaveBeenCalledWith(
      {
        eventType: 'INTERACTION_CREATE',
        command: '/talk',
        user: 'DCaccel',
        channel: 'general',
      },
      'INTERACTION_CREATE',
    );
  });

  it('upper-cases the eventType in both the binding and the headline', () => {
    const fake = makeFake();
    logGuildEvent(
      fake as unknown as Logger,
      'g-1',
      'message_update',
      { user: 'u', channel: 'c', oldMessage: 'a', newMessage: 'b' },
      'GuildName',
    );
    const [obj, headline] = (fake.info.mock.calls[0] ?? []) as [Record<string, unknown>, string];
    expect(obj['eventType']).toBe('MESSAGE_UPDATE');
    expect(headline).toBe('MESSAGE_UPDATE');
  });

  it('preserves array-valued details (e.g. role mentions) verbatim', () => {
    const fake = makeFake();
    logGuildEvent(
      fake as unknown as Logger,
      'g-1',
      'guild_member_update',
      { user: 'u', added: ['<@&1>'], removed: [] },
      'GuildName',
    );
    expect(fake.info).toHaveBeenCalledWith(
      {
        eventType: 'GUILD_MEMBER_UPDATE',
        user: 'u',
        added: ['<@&1>'],
        removed: [],
      },
      'GUILD_MEMBER_UPDATE',
    );
  });

  it('no-ops when logger is undefined', () => {
    expect(() => logGuildEvent(undefined, 'g-1', 'x', { a: 1 }, 'GuildName')).not.toThrow();
  });
});
