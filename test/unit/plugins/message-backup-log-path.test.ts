import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBackupLogPath,
  formatBackupStamp,
} from '../../../src/plugins/message-backup/internal/log-path';

describe('message-backup log-path', () => {
  describe('formatBackupStamp', () => {
    it('formats a local-time Date as YYYY-MM-DD_HH-MM-SS with zero padding', () => {
      // Local-time constructor: month is 0-based, so 2 === March.
      const date = new Date(2026, 2, 5, 9, 7, 3);
      expect(formatBackupStamp(date)).toBe('2026-03-05_09-07-03');
    });

    it('matches the YYYY-MM-DD_HH-MM-SS shape for an arbitrary Date', () => {
      const stamp = formatBackupStamp(new Date(2024, 11, 31, 23, 59, 59));
      expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
      expect(stamp).toBe('2024-12-31_23-59-59');
    });
  });

  describe('buildBackupLogPath', () => {
    it('routes the transcript under logs/backup/ with a stamped filename', () => {
      const date = new Date(2026, 2, 5, 9, 7, 3);
      const expected = join(
        process.cwd(),
        'logs',
        'backup',
        'msg-archive-guild-1-2026-03-05_09-07-03.log',
      );
      expect(buildBackupLogPath('guild-1', date)).toBe(expected);
    });
  });
});
