import * as fs from 'node:fs';
import * as path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BackupLog,
  NullBackupLog,
  type BackupTranscript,
} from '../../../src/plugins/message-backup/internal/backup-log';

// Auto-mock fs so every export is a spy; the Null Object must reach none of
// them and the file-backed log's syscalls stay assertable. (Module mock, not
// `vi.spyOn`, because node:fs's namespace properties are non-configurable
// under ESM and cannot be redefined in place.)
vi.mock('node:fs');

const FD = 7;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.openSync).mockReturnValue(FD);
});

describe('BackupLog', () => {
  it('creates the transcript directory and truncates any prior run’s file', () => {
    const filePath = path.join('logs', 'backup', 'msg-archive-g1-2026-01-01_00-00-00.log');

    new BackupLog(filePath);

    expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('logs', 'backup'), { recursive: true });
    // 'w' truncates: each run owns a fresh, timestamped artifact.
    expect(fs.openSync).toHaveBeenCalledWith(filePath, 'w');
  });

  it('terminates every line and writes it through synchronously', () => {
    // Synchronous writes are the point: a backup killed mid-pass must
    // still leave every line it reported already on disk.
    const log = new BackupLog('logs/backup/run.log');

    log.writeln('=== MSG ARCHIVE BACKUP ===');
    log.writeln();

    expect(fs.writeSync).toHaveBeenNthCalledWith(1, FD, '=== MSG ARCHIVE BACKUP ===\n');
    expect(fs.writeSync).toHaveBeenNthCalledWith(2, FD, '\n');
  });

  it('releases the descriptor it opened when closed', () => {
    const log = new BackupLog('logs/backup/run.log');

    log.close();

    expect(fs.closeSync).toHaveBeenCalledWith(FD);
  });
});

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
