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
    expect(() => logError(undefined, 'bot-1', 'g-1', new Error('boom'))).not.toThrow();
  });

  it('binds bot scope only when guildId is null/undefined/empty', () => {
    logError(fake as unknown as Logger, 'bot-1', null, new Error('x'));
    expect(fake.child).toHaveBeenCalledWith({ bot: 'bot-1' });

    fake.child.mockClear();
    logError(fake as unknown as Logger, 'bot-1', '', new Error('x'));
    expect(fake.child).toHaveBeenCalledWith({ bot: 'bot-1' });
  });

  it('binds bot + guild scope when guildId is present', () => {
    logError(fake as unknown as Logger, 'bot-1', 'g-1', new Error('x'));
    expect(fake.child).toHaveBeenCalledWith({ bot: 'bot-1', guildId: 'g-1' });
  });

  it('uses `err` key for Error instances and `raw` for primitives', () => {
    const err = new Error('boom');
    logError(fake as unknown as Logger, 'bot-1', 'g-1', err);
    expect(fake.error).toHaveBeenCalledWith({ err }, 'errorLogger');

    fake.error.mockClear();
    logError(fake as unknown as Logger, 'bot-1', 'g-1', 'string-error');
    expect(fake.error).toHaveBeenCalledWith({ raw: 'string-error' }, 'errorLogger');
  });
});

describe('logSystem', () => {
  it('no-ops when logger is undefined', () => {
    expect(() => logSystem(undefined, 'bot-1', 'hi')).not.toThrow();
  });

  it('binds bot scope and writes info', () => {
    const fake = makeFake();
    logSystem(fake as unknown as Logger, 'bot-1', 'hello');
    expect(fake.child).toHaveBeenCalledWith({ bot: 'bot-1' });
    expect(fake.info).toHaveBeenCalledWith({ msg: 'hello' }, 'system');
  });
});

describe('logGuildEvent', () => {
  it('flattens newlines and binds bot/guild/name scope', () => {
    const fake = makeFake();
    logGuildEvent(
      fake as unknown as Logger,
      'bot-1',
      'g-1',
      'role_add',
      'line1\nline2',
      'GuildName',
    );
    expect(fake.child).toHaveBeenCalledWith({
      bot: 'bot-1',
      guildId: 'g-1',
      guildName: 'GuildName',
    });
    expect(fake.info).toHaveBeenCalledWith(
      { eventType: 'ROLE_ADD', msg: 'line1\\nline2' },
      'guild event',
    );
  });
});
