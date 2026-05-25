/**
 * Unit tests for the in-process file-router sink.
 *
 * The sink is exercised directly as a `Writable` — pino is not in the
 * loop here; we simply pump JSON Lines through it and assert on the
 * files that land under a per-test temp directory.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileRouterStream } from '../../../../src/core/logger/file-router-transport';

let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'file-router-test-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(rootDir, { recursive: true, force: true });
});

const dateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Pump `lines` through the sink and await graceful close. */
const drain = async (lines: readonly string[]): Promise<void> => {
  const stream = createFileRouterStream({ rootDir });
  for (const line of lines) {
    stream.write(`${line}\n`);
  }
  await new Promise<void>((resolve, reject) => {
    stream.end((err?: unknown) => {
      if (err !== undefined && err !== null) reject(err as Error);
      else resolve();
    });
  });
};

describe('file-router stream', () => {
  it('routes a record with guildId to <root>/<bot>/<guildId>/<date>.log', async () => {
    const now = new Date(2026, 4, 25, 13, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const record = {
      level: 30,
      time: now.toISOString(),
      bot: 'bot-A',
      guildId: 'guild-1',
      msg: 'hello',
    };
    await drain([JSON.stringify(record)]);

    const expected = join(rootDir, 'bot-A', 'guild-1', `${dateKey(now)}.log`);
    expect(existsSync(expected)).toBe(true);
    const contents = readFileSync(expected, 'utf8').trim().split('\n');
    expect(contents).toHaveLength(1);
    expect(JSON.parse(contents[0]!)).toMatchObject({
      bot: 'bot-A',
      guildId: 'guild-1',
      msg: 'hello',
    });
  });

  it('routes a record without guildId to <root>/<bot>/<date>.log', async () => {
    const now = new Date(2026, 4, 25, 13, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await drain([
      JSON.stringify({ level: 30, time: now.toISOString(), bot: 'bot-A', msg: 'system line' }),
    ]);

    const expected = join(rootDir, 'bot-A', `${dateKey(now)}.log`);
    expect(existsSync(expected)).toBe(true);
    const contents = readFileSync(expected, 'utf8').trim().split('\n');
    expect(contents).toHaveLength(1);
    expect(JSON.parse(contents[0]!)).toMatchObject({ msg: 'system line' });
  });

  it('throws inside the write path when `bot` binding is missing (no _unbound fallback)', async () => {
    const now = new Date(2026, 4, 25, 13, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // The composition root attaches `{ bot: clientId }` on the root
    // logger, so any record reaching the file sink must carry it.
    // Surfacing the contract violation loudly beats silently writing
    // to a junk directory that nobody monitors.
    const stream = createFileRouterStream({ rootDir });
    const errored = new Promise<Error>((resolve) => {
      stream.once('error', (err: Error) => resolve(err));
    });
    stream.write(`${JSON.stringify({ level: 30, time: now.toISOString(), msg: 'orphan' })}\n`);
    const err = await errored;
    expect(err.message).toMatch(/missing required `bot` binding/);
    expect(existsSync(join(rootDir, '_unbound'))).toBe(false);
  });

  it('keeps each (bot,guild) bucket in its own file', async () => {
    const now = new Date(2026, 4, 25, 13, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await drain([
      JSON.stringify({ level: 30, bot: 'bot-A', guildId: 'g1', msg: 'a1' }),
      JSON.stringify({ level: 30, bot: 'bot-A', guildId: 'g2', msg: 'a2' }),
      JSON.stringify({ level: 30, bot: 'bot-B', guildId: 'g1', msg: 'b1' }),
    ]);

    expect(existsSync(join(rootDir, 'bot-A', 'g1', `${dateKey(now)}.log`))).toBe(true);
    expect(existsSync(join(rootDir, 'bot-A', 'g2', `${dateKey(now)}.log`))).toBe(true);
    expect(existsSync(join(rootDir, 'bot-B', 'g1', `${dateKey(now)}.log`))).toBe(true);
  });

  it('rotates to a new file when the local-time date changes between records', async () => {
    const day1 = new Date(2026, 4, 25, 23, 59, 30);
    const day2 = new Date(2026, 4, 26, 0, 0, 30);
    vi.useFakeTimers();
    vi.setSystemTime(day1);

    const stream = createFileRouterStream({ rootDir });
    stream.write(`${JSON.stringify({ level: 30, bot: 'bot-A', guildId: 'g1', msg: 'before' })}\n`);
    vi.setSystemTime(day2);
    stream.write(`${JSON.stringify({ level: 30, bot: 'bot-A', guildId: 'g1', msg: 'after' })}\n`);
    await new Promise<void>((resolve) => stream.end(() => resolve()));

    const guildDir = join(rootDir, 'bot-A', 'g1');
    const files = readdirSync(guildDir).sort();
    expect(files).toEqual([`${dateKey(day1)}.log`, `${dateKey(day2)}.log`]);
    expect(readFileSync(join(guildDir, files[0]!), 'utf8')).toContain('"before"');
    expect(readFileSync(join(guildDir, files[1]!), 'utf8')).toContain('"after"');
  });

  it('rejects an empty rootDir option', () => {
    expect(() => createFileRouterStream({ rootDir: '' })).toThrow(/rootDir/);
  });
});
