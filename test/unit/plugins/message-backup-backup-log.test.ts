import * as fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  NullBackupLog,
  type BackupTranscript,
} from '../../../src/plugins/message-backup/internal/backup-log';

// Auto-mock fs so every export is a spy; the Null Object must reach none of
// them. (Module mock, not `vi.spyOn`, because node:fs's namespace properties
// are non-configurable under ESM and cannot be redefined in place.)
vi.mock('node:fs');

describe('NullBackupLog', () => {
  it('is a no-op transcript that never touches the filesystem', () => {
    const log: BackupTranscript = new NullBackupLog();
    log.writeln('a line');
    log.writeln();
    log.close();

    // No `logs/backup/` directory or file is ever created.
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.openSync).not.toHaveBeenCalled();
    expect(fs.writeSync).not.toHaveBeenCalled();
  });
});
