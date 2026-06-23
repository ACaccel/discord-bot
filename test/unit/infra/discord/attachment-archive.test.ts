import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from 'axios';
import { rmSync } from 'fs';
import { resolve } from 'path';

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
  // The helper mkdir's ./data/deleted_attachments/<guildId>/ before the
  // (mocked-to-fail) download, so the real directory is created as a side
  // effect of exercising the function. Remove it after each case so a unit run
  // leaves no artifact in the working tree (`data/` is gitignored but should
  // not be polluted). `force` tolerates an already-absent directory.
  afterEach(() => {
    rmSync(resolve('data/deleted_attachments/g-1'), { recursive: true, force: true });
  });

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
