import { describe, expect, it, vi } from 'vitest';

import { sendChannelLog } from '../../../../src/infra/discord';
import type { Logger } from '../../../../src/core/logger';

const fakeLogger = (): Logger =>
  ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => fakeLogger()),
  }) as unknown as Logger;

describe('sendChannelLog', () => {
  it('returns immediately when channel is undefined or not sendable', async () => {
    const logger = fakeLogger();
    await sendChannelLog(logger, undefined, undefined, 'hi');
    await sendChannelLog(logger, { isSendable: () => false } as never, undefined, 'hi');
    expect((logger.error as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('sends log and embed when both provided', async () => {
    const send = vi.fn(async () => undefined);
    const channel = { isSendable: () => true, send } as never;
    await sendChannelLog(undefined, channel, { x: 1 } as never, 'hi');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'hi');
    expect(send).toHaveBeenNthCalledWith(2, { embeds: [{ x: 1 }] });
  });

  it('logs structured error on send failure', async () => {
    const logger = fakeLogger();
    const channel = {
      isSendable: () => true,
      send: vi.fn(async () => {
        throw new Error('Missing Permissions');
      }),
    } as never;
    await sendChannelLog(logger, channel, undefined, 'hi');
    expect((logger.error as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
