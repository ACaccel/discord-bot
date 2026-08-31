/**
 * Unit suite for the `migrate-timestamp` command. Covers the pure query /
 * pipeline builders, the options schema defaults, and the failure /
 * summary derivation; the Mongo-touching paths run only in manual ops.
 */
import { describe, expect, it } from 'vitest';

import {
  backupCollectionName,
  buildConvertFilter,
  buildConvertPipeline,
  buildIndexSpecs,
  computeFailure,
  migrateTimestampOptionsSchema,
  MIGRATE_MODES,
  summaryLine,
} from './migrate-timestamp';

describe('migrate-timestamp / builders', () => {
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

describe('migrate-timestamp / options schema', () => {
  it('applies defaults for dry_run and sample_limit', () => {
    expect(migrateTimestampOptionsSchema.parse({ mode: 'audit' })).toEqual({
      mode: 'audit',
      dry_run: false,
      sample_limit: 20,
    });
  });

  it('accepts every declared mode and rejects unknown ones', () => {
    for (const mode of MIGRATE_MODES) {
      expect(migrateTimestampOptionsSchema.parse({ mode }).mode).toBe(mode);
    }
    expect(migrateTimestampOptionsSchema.safeParse({ mode: 'wipe' }).success).toBe(false);
  });
});

describe('migrate-timestamp / computeFailure', () => {
  const auditOutcome = (guildId: string, numericString: number) =>
    ({
      guildId,
      ok: true,
      result: {
        mode: 'audit',
        total: 0,
        stringTyped: 0,
        numericString,
        nonNumericString: 0,
        nullOrMissing: 0,
      },
      error: null,
    }) as const;

  it('never fails in audit mode regardless of counts', () => {
    expect(
      computeFailure({ mode: 'audit', dry_run: false, sample_limit: 20 }, [auditOutcome('1', 999)]),
    ).toBe(false);
  });

  it('fails when any guild errored', () => {
    expect(
      computeFailure({ mode: 'index', dry_run: false, sample_limit: 20 }, [
        { guildId: '1', ok: false, result: null, error: 'boom' },
      ]),
    ).toBe(true);
  });

  it('fails a non-dry convert that left String-typed timestamps behind', () => {
    expect(
      computeFailure({ mode: 'convert', dry_run: false, sample_limit: 20 }, [
        {
          guildId: '1',
          ok: true,
          result: {
            mode: 'convert',
            status: 'manual-triage-required',
            dryRun: false,
            total: 10,
            stringTypedBefore: 3,
            numericStringBefore: 3,
            nonNumericString: 0,
            backupCollection: 'messages_backup_pre_ts_x',
            modifiedCount: 1,
            numericStringAfter: 2,
            sample: [],
          },
          error: null,
        },
      ]),
    ).toBe(true);
  });
});

describe('migrate-timestamp / summaryLine', () => {
  const auditOutcome = (guildId: string, numericString: number, nonNumericString: number) =>
    ({
      guildId,
      ok: true,
      result: {
        mode: 'audit',
        total: 0,
        stringTyped: 0,
        numericString,
        nonNumericString,
        nullOrMissing: 0,
      },
      error: null,
    }) as const;

  it('recommends no conversion when every guild is clean', () => {
    const line = summaryLine(
      { mode: 'audit', dry_run: false, sample_limit: 20 },
      [auditOutcome('1', 0, 0)],
      false,
    );
    expect(line).toContain('NO CONVERSION NEEDED');
  });

  it('flags the guilds that require conversion', () => {
    const line = summaryLine(
      { mode: 'audit', dry_run: false, sample_limit: 20 },
      [auditOutcome('123', 5, 0)],
      false,
    );
    expect(line).toContain('CONVERSION REQUIRED for guilds [123]');
  });
});
