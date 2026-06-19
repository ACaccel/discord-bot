/**
 * Unit suite for the `drop_todo_collection` ops tool. Targets the pure
 * helpers exported from `./internal.ts`; the process-lifecycle entry
 * point (`drop_todo_collection.ts`) is exercised only through manual
 * runs against a real Mongo cluster.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../src/core/errors/configuration-error';

import { buildGuildUri, parseConfig } from './internal';

describe('drop_todo_collection / buildGuildUri', () => {
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

describe('drop_todo_collection / parseConfig', () => {
  let tmpDir: string;
  const writeConfig = (body: unknown): string => {
    const p = join(tmpDir, 'config.json');
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    return p;
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'drop-todo-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a minimal valid config and defaults dry_run=true, output_path=null', () => {
    const cfg = parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['123'] }));
    expect(cfg).toEqual({
      mongoUri: 'mongodb://h/',
      guilds: ['123'],
      dryRun: true,
      outputPath: null,
    });
  });

  it('honours an explicit dry_run=false', () => {
    const cfg = parseConfig(
      writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'], dry_run: false }),
    );
    expect(cfg.dryRun).toBe(false);
  });

  it('accepts multiple guild ids', () => {
    const cfg = parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1', '2', '3'] }));
    expect(cfg.guilds).toEqual(['1', '2', '3']);
  });

  it('honours an explicit output_path', () => {
    const cfg = parseConfig(
      writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'], output_path: '/tmp/report.json' }),
    );
    expect(cfg.outputPath).toBe('/tmp/report.json');
  });

  it('rejects missing mongo_uri', () => {
    expect(() => parseConfig(writeConfig({ guilds: ['1'] }))).toThrow(ConfigurationError);
  });

  it('rejects a missing or empty guilds array', () => {
    expect(() => parseConfig(writeConfig({ mongo_uri: 'mongodb://h/' }))).toThrow(
      ConfigurationError,
    );
    expect(() => parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: [] }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects a non-digit guild id', () => {
    expect(() => parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['abc'] }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects a non-boolean dry_run', () => {
    expect(() =>
      parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'], dry_run: 'yes' })),
    ).toThrow(ConfigurationError);
  });

  it('rejects an empty-string output_path', () => {
    expect(() =>
      parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'], output_path: '' })),
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
