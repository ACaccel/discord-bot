import { describe, expect, it, vi } from 'vitest';

import axios from 'axios';

import { archiveDeletedAttachment } from '../../../../src/infra/discord';
import type { Logger } from '../../../../src/core/logger';

vi.mock('axios');

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

describe('archiveDeletedAttachment', () => {
  it('logs warn when the upstream fetch fails (no disk write attempted past mkdir)', async () => {
    const logger = fakeLogger();
    (axios.get as unknown as ReturnType<typeof vi.fn>) = vi.fn(async () => {
      throw new Error('upstream 404');
    });
    const attachment = {
      name: 'pic.png',
      url: 'https://example.invalid/pic.png',
    } as never;
    await archiveDeletedAttachment(logger, 'g-1', attachment);
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
