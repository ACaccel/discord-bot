import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from 'axios';
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { Readable } from 'node:stream';
import { resolve } from 'path';

import { archiveDeletedAttachment, archiveDeletedAttachments } from '../../../../src/infra/discord';
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

const attachmentNamed = (name: string) =>
  ({ name, url: `https://example.invalid/${name}` }) as never;

/** Archive directory the helper writes into for guild `g-1`. */
const ARCHIVE_DIR = resolve('data/deleted_attachments/g-1');

const setAxiosGet = (impl: (...args: unknown[]) => unknown): void => {
  (axios.get as unknown as ReturnType<typeof vi.fn>) = vi.fn(impl);
};

/** Names of the files the helper wrote for guild `g-1`, if any. */
const listArchiveFiles = (): string[] => (existsSync(ARCHIVE_DIR) ? readdirSync(ARCHIVE_DIR) : []);

const findOnlyFileName = (): string => {
  const files = listArchiveFiles();
  if (files.length !== 1) {
    throw new Error(`expected exactly one archived file, found ${files.length}`);
  }
  return files[0] as string;
};

describe('archiveDeletedAttachment', () => {
  // The helper mkdir's ./data/deleted_attachments/<guildId>/ before the
  // download, so the real directory is created as a side effect of exercising
  // the function. Remove it after each case so a unit run leaves no artifact
  // in the working tree (`data/` is gitignored but should not be polluted).
  // `force` tolerates an already-absent directory.
  afterEach(() => {
    rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  });

  it('logs warn when the upstream fetch fails (no disk write attempted past mkdir)', async () => {
    const logger = fakeLogger();
    setAxiosGet(async () => {
      throw new Error('upstream 404');
    });
    await archiveDeletedAttachment(logger, 'g-1', attachmentNamed('pic.png'));
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('requests the download with a wall-clock deadline and a size ceiling', async () => {
    const logger = fakeLogger();
    setAxiosGet(async () => ({ data: Readable.from(['payload']) }));

    await archiveDeletedAttachment(logger, 'g-1', attachmentNamed('bounded.bin'));

    const [, options] = (axios.get as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { signal?: AbortSignal; maxContentLength?: number },
    ];
    // A true deadline, not axios's `timeout` (socket inactivity, which a
    // slow trickle resets forever): without it a stalled CDN response
    // hangs the transfer promise and leaks the open write handle.
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.maxContentLength).toBeGreaterThan(0);
  });

  it('writes the streamed body to disk', async () => {
    const logger = fakeLogger();
    setAxiosGet(async () => ({ data: Readable.from(['hello ', 'world']) }));

    await archiveDeletedAttachment(logger, 'g-1', attachmentNamed('note.txt'));

    const written = readFileSync(resolve(ARCHIVE_DIR, findOnlyFileName()), 'utf8');
    expect(written).toBe('hello world');
  });

  it('resolves (and removes the partial file) when the source stream errors mid-transfer', async () => {
    const logger = fakeLogger();
    setAxiosGet(async () => ({
      data: new Readable({
        read(): void {
          this.push('partial');
          this.destroy(new Error('CDN connection reset'));
        },
      }),
    }));

    // The old `pipe` + `finish` listener never observed a source error, so
    // this promise stayed pending forever. It must settle.
    await archiveDeletedAttachment(logger, 'g-1', attachmentNamed('truncated.bin'));

    expect((logger.error as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(listArchiveFiles()).toEqual([]);
  });
});

describe('archiveDeletedAttachments', () => {
  afterEach(() => {
    rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  });

  it('bounds how many downloads run at once across a bulk delete', async () => {
    const logger = fakeLogger();
    let inFlight = 0;
    let peak = 0;
    setAxiosGet(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { data: Readable.from(['x']) };
    });

    const attachments = Array.from({ length: 20 }, (_, i) => attachmentNamed(`bulk-${i}.bin`));
    await archiveDeletedAttachments(logger, 'g-1', attachments);

    expect((axios.get as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(20);
    // A bulk delete of 100 messages used to open every download at once.
    expect(peak).toBeLessThanOrEqual(4);
  });
});
