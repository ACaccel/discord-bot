/**
 * Unit tests for {@link applyOriginalMessageStrategy}: the permission
 * gate and the suppress / delete / leave matrix. The critical case is
 * "permission missing -> nothing mutated, no throw" (the reply-only
 * fallback), plus "Discord call throws -> swallowed".
 */
import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';

import { applyOriginalMessageStrategy } from '../../../../src/plugins/social-link-preview/internal/suppress';
import type { Logger } from '../../../../src/core/logger';

const makeLogger = (): Logger => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger as unknown as Logger;
};

interface MsgOpts {
  readonly hasPerm?: boolean;
  readonly permsNull?: boolean;
  readonly inGuild?: boolean;
  readonly nullBotUser?: boolean;
  readonly suppressThrows?: boolean;
}

const makeMessage = (opts: MsgOpts = {}) => {
  const calls = { suppress: 0, delete: 0, permissionsFor: 0 };
  const permissions = { has: vi.fn(() => opts.hasPerm ?? true) };
  const channel = {
    permissionsFor: vi.fn(() => {
      calls.permissionsFor += 1;
      return opts.permsNull === true ? null : permissions;
    }),
  };
  const message = {
    inGuild: () => opts.inGuild ?? true,
    client: { user: opts.nullBotUser === true ? null : { id: 'bot' } },
    channel,
    channelId: 'c1',
    guildId: 'g1',
    suppressEmbeds: vi.fn(async () => {
      calls.suppress += 1;
      if (opts.suppressThrows === true) throw new Error('already deleted');
    }),
    delete: vi.fn(async () => {
      calls.delete += 1;
    }),
  };
  return { message: message as unknown as Message, calls };
};

describe('applyOriginalMessageStrategy', () => {
  it('suppresses embeds when permitted', async () => {
    const { message, calls } = makeMessage({ hasPerm: true });
    await applyOriginalMessageStrategy(message, 'suppress', makeLogger());
    expect(calls.suppress).toBe(1);
    expect(calls.delete).toBe(0);
  });

  it('deletes the message when permitted and strategy is delete', async () => {
    const { message, calls } = makeMessage({ hasPerm: true });
    await applyOriginalMessageStrategy(message, 'delete', makeLogger());
    expect(calls.delete).toBe(1);
    expect(calls.suppress).toBe(0);
  });

  it('does nothing and never checks permissions for the leave strategy', async () => {
    const { message, calls } = makeMessage({ hasPerm: true });
    await applyOriginalMessageStrategy(message, 'leave', makeLogger());
    expect(calls.permissionsFor).toBe(0);
    expect(calls.suppress).toBe(0);
    expect(calls.delete).toBe(0);
  });

  it('falls back to reply-only (no mutation, debug log) when ManageMessages is missing', async () => {
    const { message, calls } = makeMessage({ hasPerm: false });
    const logger = makeLogger();
    await applyOriginalMessageStrategy(message, 'suppress', logger);
    expect(calls.suppress).toBe(0);
    expect(calls.delete).toBe(0);
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('treats a null permissions result as missing permission', async () => {
    const { message, calls } = makeMessage({ permsNull: true });
    await applyOriginalMessageStrategy(message, 'suppress', makeLogger());
    expect(calls.suppress).toBe(0);
  });

  it('does nothing outside a guild', async () => {
    const { message, calls } = makeMessage({ inGuild: false });
    await applyOriginalMessageStrategy(message, 'suppress', makeLogger());
    expect(calls.permissionsFor).toBe(0);
    expect(calls.suppress).toBe(0);
  });

  it('does nothing when the bot user is not yet resolved', async () => {
    const { message, calls } = makeMessage({ nullBotUser: true });
    await applyOriginalMessageStrategy(message, 'suppress', makeLogger());
    expect(calls.permissionsFor).toBe(0);
    expect(calls.suppress).toBe(0);
  });

  it('swallows a Discord error and logs it (no throw)', async () => {
    const { message } = makeMessage({ hasPerm: true, suppressThrows: true });
    const logger = makeLogger();
    await expect(
      applyOriginalMessageStrategy(message, 'suppress', logger),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
