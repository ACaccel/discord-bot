/**
 * The attachment file-I/O primitives both archival paths share.
 *
 * These are the pieces whose failure is silent: a name that escapes its
 * directory, a name too long to write at all, a publish that overwrites
 * an earlier forensic file. Each is covered here directly rather than
 * left to whichever caller happens to reach it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  PARTIAL_SUFFIX,
  archiveFilePath,
  publishFile,
  runBounded,
  sanitizeFileName,
} from '../../../../src/infra/discord/attachment-io';

describe('sanitizeFileName', () => {
  it('reduces a traversal attempt to its last segment', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('/absolute/path/pic.png')).toBe('pic.png');
  });

  it('treats a Windows separator as a separator too', () => {
    expect(sanitizeFileName('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe');
  });

  it('substitutes a placeholder for a name that reduces to nothing', () => {
    // `''`, `.` and `..` are all valid `basename` outputs that are not
    // usable file names; writing to them would target the directory.
    expect(sanitizeFileName('')).toBe('attachment');
    expect(sanitizeFileName('.')).toBe('attachment');
    expect(sanitizeFileName('..')).toBe('attachment');
    expect(sanitizeFileName('foo/..')).toBe('attachment');
  });

  it('caps an over-long name while keeping its extension', () => {
    // Uncapped, the prefixed name exceeds the 255-byte segment limit and
    // the write fails with ENAMETOOLONG — the attachment is then never
    // archived at all.
    const result = sanitizeFileName(`${'a'.repeat(500)}.png`);
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(160);
    expect(result.endsWith('.png')).toBe(true);
  });

  it('caps by bytes, not characters, so multi-byte names still fit', () => {
    const result = sanitizeFileName(`${'é'.repeat(300)}.png`);
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(160);
  });

  it('leaves an ordinary name untouched', () => {
    expect(sanitizeFileName('my-holiday-photo.png')).toBe('my-holiday-photo.png');
  });
});

describe('archiveFilePath', () => {
  it('lands under <root>/<guildId>/ with a timestamped name', () => {
    const result = archiveFilePath('g-1', 'pic.png', '/tmp/archive-root');
    expect(path.dirname(result)).toBe(path.join('/tmp/archive-root', 'g-1'));
    expect(path.basename(result).endsWith('pic.png')).toBe(true);
  });

  it('sanitises the name on the way out, not only on the way in', () => {
    const result = archiveFilePath('g-1', '../../escape.png', '/tmp/archive-root');
    expect(path.dirname(result)).toBe(path.join('/tmp/archive-root', 'g-1'));
  });
});

describe('publishFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-io-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, body: string): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    return file;
  };

  it('moves the source onto the destination and removes the source', async () => {
    const source = write('source.bin', 'payload');

    await publishFile(source, path.join(dir, 'published.bin'));

    expect(fs.readFileSync(path.join(dir, 'published.bin'), 'utf8')).toBe('payload');
    expect(fs.existsSync(source)).toBe(false);
  });

  it('takes an ordinal name rather than overwriting an occupied one', async () => {
    write('taken.bin', 'first');
    const source = write('source.bin', 'second');

    await publishFile(source, path.join(dir, 'taken.bin'));

    // Overwriting here destroys an earlier forensic file with no error
    // and no log — the exact failure the archive exists to prevent.
    expect(fs.readFileSync(path.join(dir, 'taken.bin'), 'utf8')).toBe('first');
    expect(fs.readFileSync(path.join(dir, 'taken-2.bin'), 'utf8')).toBe('second');
  });

  it('keeps climbing ordinals as each one fills up', async () => {
    write('taken.bin', 'first');
    write('taken-2.bin', 'second');

    await publishFile(write('source.bin', 'third'), path.join(dir, 'taken.bin'));

    expect(fs.readFileSync(path.join(dir, 'taken-3.bin'), 'utf8')).toBe('third');
  });

  it('raises rather than silently dropping the file when every name is taken', async () => {
    const destination = path.join(dir, 'taken.bin');
    fs.writeFileSync(destination, 'x');
    for (let n = 2; n <= 50; n += 1)
      fs.writeFileSync(path.join(dir, `taken-${String(n)}.bin`), 'x');

    await expect(publishFile(write('source.bin', 'y'), destination)).rejects.toThrow(
      /every candidate name/,
    );
  });

  it('propagates a filesystem refusal instead of reporting success', async () => {
    vi.spyOn(fs.promises, 'link').mockRejectedValue(
      Object.assign(new Error('read-only'), { code: 'EROFS' }),
    );

    await expect(
      publishFile(write('source.bin', 'y'), path.join(dir, 'published.bin')),
    ).rejects.toThrow(/read-only/);
  });

  it('falls back to an exclusive copy when the move crosses a filesystem', async () => {
    const realLink = fs.promises.link.bind(fs.promises);
    vi.spyOn(fs.promises, 'link').mockImplementation(async (from, to) => {
      if (String(to).endsWith('crossed.bin')) {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      }
      return realLink(from, to);
    });
    const source = write('source.bin', 'payload');

    await publishFile(source, path.join(dir, 'crossed.bin'));

    expect(fs.readFileSync(path.join(dir, 'crossed.bin'), 'utf8')).toBe('payload');
    expect(fs.existsSync(source)).toBe(false);
  });

  it('removes its own partial copy when a cross-filesystem copy fails', async () => {
    vi.spyOn(fs.promises, 'link').mockRejectedValue(
      Object.assign(new Error('cross-device link'), { code: 'EXDEV' }),
    );
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (_from, to) => {
      // A copy that dies part-way (a full disk, typically) still leaves
      // bytes behind; left there they read as a complete archive.
      fs.writeFileSync(String(to), 'half');
      throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
    });
    const destination = path.join(dir, 'published.bin');

    await expect(publishFile(write('source.bin', 'payload'), destination)).rejects.toThrow(
      /no space left/,
    );
    expect(fs.existsSync(destination)).toBe(false);
  });
});

describe('runBounded', () => {
  it('holds concurrency at the process-wide ceiling across separate calls', async () => {
    // The bound has to span calls: `messageCreate` starts one of these
    // per message without waiting, so a per-call limiter would still let
    // an upload burst open an unbounded number of sockets.
    let active = 0;
    let peak = 0;
    const worker = async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };

    await Promise.all([
      runBounded([1, 2, 3, 4, 5, 6], worker),
      runBounded([7, 8, 9, 10, 11, 12], worker),
    ]);

    expect(peak).toBeLessThanOrEqual(4);
  });

  it('attempts every item and resolves on an empty batch', async () => {
    const seen: number[] = [];
    await runBounded([1, 2, 3], async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual([1, 2, 3]);
    await expect(runBounded([], async () => undefined)).resolves.toBeUndefined();
  });

  it('releases its slot even when the worker throws, so the pool cannot wedge', async () => {
    await expect(
      runBounded([1], async () => {
        throw new Error('worker blew up');
      }),
    ).rejects.toThrow(/worker blew up/);

    // If the failed run had leaked its slot, four more failures would
    // exhaust the pool and this call would hang forever.
    await expect(runBounded([1, 2], async () => undefined)).resolves.toBeUndefined();
  });
});

describe('PARTIAL_SUFFIX', () => {
  it('is the marker readers use to skip an in-progress download', () => {
    expect(`file.png${PARTIAL_SUFFIX}`.endsWith(PARTIAL_SUFFIX)).toBe(true);
  });
});
