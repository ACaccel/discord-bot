/**
 * Unit suite for the `migrate_timestamp` ops tool. Targets the pure
 * helpers exported from `./internal.ts`; the process-lifecycle entry
 * point (`migrate_timestamp.ts`) is exercised only through manual runs
 * against a real Mongo cluster.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../src/core/errors/configuration-error';

import {
  backupCollectionName,
  buildConvertFilter,
  buildConvertPipeline,
  buildIndexSpecs,
  MIGRATE_MODES,
  parseConfig,
} from './internal';

describe('migrate_timestamp / parseConfig', () => {
  let tmpDir: string;
  const writeConfig = (body: unknown): string => {
    const p = join(tmpDir, 'config.json');
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    return p;
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'migrate-ts-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a minimal valid config and applies defaults', () => {
    const cfg = parseConfig(
      writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['123'], mode: 'audit' }),
    );
    expect(cfg.guilds).toEqual(['123']);
    expect(cfg.mode).toBe('audit');
    expect(cfg.dryRun).toBe(false);
    expect(cfg.sampleLimit).toBe(20);
    expect(cfg.outputPath).toBeNull();
  });

  it('normalises mongo_uri to host-with-trailing-slash, stripping the query string', () => {
    const cfg = parseConfig(
      writeConfig({ mongo_uri: 'mongodb://h/?authSource=admin', guilds: ['1'], mode: 'index' }),
    );
    expect(cfg.mongoUri).toBe('mongodb://h/');
  });

  it('passes dry_run, sample_limit and output_path through when set', () => {
    const cfg = parseConfig(
      writeConfig({
        mongo_uri: 'mongodb://h/',
        guilds: ['1'],
        mode: 'convert',
        dry_run: true,
        sample_limit: 5,
        output_path: '/tmp/report.json',
      }),
    );
    expect(cfg.dryRun).toBe(true);
    expect(cfg.sampleLimit).toBe(5);
    expect(cfg.outputPath).toBe('/tmp/report.json');
  });

  it('rejects a missing config file', () => {
    expect(() => parseConfig(join(tmpDir, 'does-not-exist.json'))).toThrow(ConfigurationError);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseConfig(writeConfig('{ not json'))).toThrow(ConfigurationError);
  });

  it('rejects a missing mongo_uri', () => {
    expect(() => parseConfig(writeConfig({ guilds: ['1'], mode: 'audit' }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects an empty guilds array', () => {
    expect(() =>
      parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: [], mode: 'audit' })),
    ).toThrow(ConfigurationError);
  });

  it('rejects a non-digit guild id', () => {
    expect(() =>
      parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['abc'], mode: 'audit' })),
    ).toThrow(ConfigurationError);
  });

  it('rejects an unknown mode', () => {
    expect(() =>
      parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'], mode: 'wipe' })),
    ).toThrow(ConfigurationError);
  });

  it('rejects a non-boolean dry_run', () => {
    expect(() =>
      parseConfig(
        writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'], mode: 'convert', dry_run: 'yes' }),
      ),
    ).toThrow(ConfigurationError);
  });

  it('rejects a negative sample_limit', () => {
    expect(() =>
      parseConfig(
        writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'], mode: 'audit', sample_limit: -1 }),
      ),
    ).toThrow(ConfigurationError);
  });

  it('rejects an empty-string output_path', () => {
    expect(() =>
      parseConfig(
        writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'], mode: 'audit', output_path: '' }),
      ),
    ).toThrow(ConfigurationError);
  });

  it('accepts every declared mode', () => {
    for (const mode of MIGRATE_MODES) {
      const cfg = parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'], mode }));
      expect(cfg.mode).toBe(mode);
    }
  });
});

describe('migrate_timestamp / builders', () => {
  it('buildConvertFilter targets only String-typed all-digit timestamps', () => {
    expect(buildConvertFilter()).toEqual({ timestamp: { $type: 'string', $regex: /^[0-9]+$/ } });
  });

  it('buildConvertPipeline coerces to long and leaves unconvertible values untouched', () => {
    expect(buildConvertPipeline()).toEqual([
      {
        $set: {
          timestamp: { $convert: { input: '$timestamp', to: 'long', onError: '$timestamp' } },
        },
      },
    ]);
  });

  it('backupCollectionName encodes a sortable, identifier-safe UTC stamp', () => {
    const name = backupCollectionName(Date.UTC(2026, 5, 18, 12, 30, 45));
    expect(name).toBe('messages_backup_pre_ts_2026-06-18T12-30-45-000Z');
    expect(name).not.toMatch(/[:.]/);
  });

  it('buildIndexSpecs declares the single and compound timestamp indexes', () => {
    expect(buildIndexSpecs()).toEqual([
      { name: 'timestamp_1', spec: { timestamp: 1 } },
      { name: 'channelId_1_timestamp_1', spec: { channelId: 1, timestamp: 1 } },
    ]);
  });
});
