/**
 * Characterisation + behaviour test for the channel-logging middleware.
 *
 * Pins the load-bearing contract that the previously-untested suppression path
 * now upholds via {@link PermissionRankPolicy}: a command in a channel above
 * the `channel_logging` rank ceiling is kept OUT of the debug feed
 * (`sendChannelLog` not called), but the durable guild audit-log line
 * (`logGuildEvent`) ALWAYS fires — even for a suppressed channel and even
 * when the dispatched handler threw (the try/finally invariant).
 */
/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `middlewares.ts` imports the interaction dispatchers (`@cmd` etc.), whose
// barrels transitively load the generated handler registry. Stub them so the
// test does not boot the entire command surface just to exercise logging.
vi.mock('@cmd', () => ({
  registerCommands: async (): Promise<void> => {},
  getCommandJsonBody: (): unknown[] => [],
  executeCommand: async (): Promise<void> => {},
}));
vi.mock('@button', () => ({
  registerButtons: async (): Promise<void> => {},
  executeButton: async (): Promise<void> => {},
}));
vi.mock('@modal', () => ({
  registerModals: async (): Promise<void> => {},
  executeModal: async (): Promise<void> => {},
}));
vi.mock('@select-menu', () => ({
  registerSSMs: async (): Promise<void> => {},
  executeSSM: async (): Promise<void> => {},
}));

// Mock the two log sinks the middleware drives; keep `parentChannelIdOf` real
// so the parent-thread extraction is exercised, not stubbed.
vi.mock('@core/logger', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  logGuildEvent: vi.fn(),
}));
vi.mock('../../../src/infra/discord', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  sendChannelLog: vi.fn(),
}));

import { logGuildEvent } from '@core/logger';
import { sendChannelLog } from '../../../src/infra/discord';
import { createChannelLoggingMiddleware } from '../../../src/bot/middlewares';
import { createPermissionRankPolicy } from '../../../src/core/plugin';
import { createLogger } from '../../../src/core/logger';
import type { BaseBot } from '../../../src/bot/index';
import type { InteractionContext } from '../../../src/core/plugin';

const silent = createLogger({ level: 'silent', pretty: false });

const fakeBot = (): BaseBot =>
  ({
    logger: silent,
    getGuildInfo: () => ({ channels: { debug: { id: 'debug-channel' } } }),
  }) as unknown as BaseBot;

const interactionCtx = (channelId: string): InteractionContext =>
  ({
    interaction: {
      isChatInputCommand: () => true,
      isContextMenuCommand: () => false,
      channelId,
      guildId: 'g1',
      channel: { parentId: null },
      commandName: 'ping',
      user: { displayName: 'User' },
      guild: { id: 'g1', name: 'Guild', channels: { cache: { get: () => ({ name: channelId }) } } },
    },
  }) as unknown as InteractionContext;

const run = async (channelId: string): Promise<void> => {
  const policy = createPermissionRankPolicy({ g1: { channels: { private: 1 } } });
  const middleware = createChannelLoggingMiddleware(fakeBot(), { policy });
  await middleware.run(interactionCtx(channelId), async () => undefined);
};

describe('channel-logging middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs a command in a rank-0 channel to the debug feed AND the guild audit log', async () => {
    await run('public');
    expect(sendChannelLog).toHaveBeenCalledTimes(1);
    expect(logGuildEvent).toHaveBeenCalledTimes(1);
  });

  it('suppresses the debug feed for a channel above the channel_logging ceiling, but still writes the audit log', async () => {
    await run('private');
    expect(sendChannelLog).not.toHaveBeenCalled();
    expect(logGuildEvent).toHaveBeenCalledTimes(1);
  });

  it('still writes the guild audit log when the dispatched handler throws, then re-throws (try/finally)', async () => {
    const policy = createPermissionRankPolicy({ g1: { channels: { private: 1 } } });
    const middleware = createChannelLoggingMiddleware(fakeBot(), { policy });
    await expect(
      middleware.run(interactionCtx('public'), async () => {
        throw new Error('dispatch failed');
      }),
    ).rejects.toThrow('dispatch failed');
    // The audit line must land even though dispatch crashed — it is in `finally`.
    expect(logGuildEvent).toHaveBeenCalledTimes(1);
  });
});
