/**
 * Unit suite for the `verify_db` ops tool. Targets the pure helpers
 * exported from `./internal.ts`; the process-lifecycle entry point
 * (`verify_db.ts`) is exercised only through manual runs against a
 * real Mongo cluster.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../src/core/errors/configuration-error';

import { buildGuildUri, createProgressWriter, parseConfig } from './internal';

describe('verify_db / buildGuildUri', () => {
  it('appends authSource=admin when the base URI has no query string', () => {
    expect(buildGuildUri('mongodb://localhost:27017/', '123')).toBe(
      'mongodb://localhost:27017/123?authSource=admin',
    );
  });

  it('preserves an explicit authSource value', () => {
    expect(buildGuildUri('mongodb://localhost:27017/?authSource=user', '123')).toBe(
      'mongodb://localhost:27017/123?authSource=user',
    );
  });

  it('defaults authSource=admin even when other query params are present', () => {
    const out = buildGuildUri('mongodb://h/?replicaSet=rs0&tls=true', '999');
    const u = new URL(out);
    expect(u.searchParams.get('replicaSet')).toBe('rs0');
    expect(u.searchParams.get('tls')).toBe('true');
    expect(u.searchParams.get('authSource')).toBe('admin');
    expect(u.pathname).toBe('/999');
  });

  it('strips trailing slashes from the host portion', () => {
    expect(buildGuildUri('mongodb://h///', '42')).toBe('mongodb://h/42?authSource=admin');
  });
});

describe('verify_db / parseConfig', () => {
  let tmpDir: string;
  const writeConfig = (body: unknown): string => {
    const p = join(tmpDir, 'config.json');
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    return p;
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verify-db-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a minimal valid config and defaults sample_limit=50, output_path=null', () => {
    const cfg = parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guild_id: '123' }));
    expect(cfg).toEqual({
      mongoUri: 'mongodb://h/',
      guildId: '123',
      sampleLimit: 50,
      outputPath: null,
    });
  });

  it('honours an explicit sample_limit (including zero)', () => {
    const cfg = parseConfig(
      writeConfig({ mongo_uri: 'mongodb://h/', guild_id: '1', sample_limit: 0 }),
    );
    expect(cfg.sampleLimit).toBe(0);
  });

  it('honours an explicit output_path', () => {
    const cfg = parseConfig(
      writeConfig({
        mongo_uri: 'mongodb://h/',
        guild_id: '1',
        output_path: '/tmp/report.json',
      }),
    );
    expect(cfg.outputPath).toBe('/tmp/report.json');
  });

  it('rejects missing mongo_uri', () => {
    expect(() => parseConfig(writeConfig({ guild_id: '1' }))).toThrow(ConfigurationError);
  });

  it('rejects missing guild_id', () => {
    expect(() => parseConfig(writeConfig({ mongo_uri: 'mongodb://h/' }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects a non-digit guild_id', () => {
    expect(() => parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guild_id: 'abc' }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects a negative or non-integer sample_limit', () => {
    expect(() =>
      parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guild_id: '1', sample_limit: -1 })),
    ).toThrow(ConfigurationError);
    expect(() =>
      parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guild_id: '1', sample_limit: 1.5 })),
    ).toThrow(ConfigurationError);
  });

  it('rejects an empty-string output_path', () => {
    expect(() =>
      parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guild_id: '1', output_path: '' })),
    ).toThrow(ConfigurationError);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseConfig(writeConfig('not json{'))).toThrow(ConfigurationError);
  });

  it('rejects a non-object root', () => {
    expect(() => parseConfig(writeConfig('[]'))).toThrow(ConfigurationError);
  });

  it('rejects a missing file path', () => {
    expect(() => parseConfig(join(tmpDir, 'does-not-exist.json'))).toThrow(ConfigurationError);
  });
});

describe('verify_db / createProgressWriter', () => {
  const collectSink = (): { sink: { write: (text: string) => void }; out: string[] } => {
    const out: string[] = [];
    return { sink: { write: (text: string): void => void out.push(text) }, out };
  };

  it('TTY mode rewrites the same line with \\r + clear-line escape', () => {
    const { sink, out } = collectSink();
    const writer = createProgressWriter(sink, true);
    writer('step 1', false);
    writer('step 1 done', true);
    expect(out).toEqual(['\r\x1b[2Kstep 1', '\r\x1b[2Kstep 1 done\n']);
  });

  it('non-TTY mode appends a newline per write and never emits escape codes', () => {
    const { sink, out } = collectSink();
    const writer = createProgressWriter(sink, false);
    writer('step 1', false);
    writer('step 1 done', true);
    expect(out).toEqual(['step 1\n', 'step 1 done\n']);
    for (const line of out) {
      expect(line).not.toContain('\r');
      expect(line).not.toContain('\x1b');
    }
  });
});
