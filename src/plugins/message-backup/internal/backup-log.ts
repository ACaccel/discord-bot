/**
 * Per-guild backup transcript sink used by the message-backup plugin.
 *
 * `BackupLog` writes the append-only newline-terminated log file that ops
 * dashboards grep; `NullBackupLog` is the opt-out (Null Object pattern) used
 * when transcript logging is disabled, so the dozens of `writeln` call sites in
 * `performBackup` stay untouched. Caller is responsible for calling `close()`
 * in a `finally`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The transcript surface `performBackup` writes through. */
export interface BackupTranscript {
  writeln(line?: string): void;
  close(): void;
}

/**
 * File-backed transcript. Synchronous `fs.writeSync` — guarantees the line
 * lands even if the process is signalled mid-backup.
 */
export class BackupLog implements BackupTranscript {
  private readonly fd: number;
  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.fd = fs.openSync(filePath, 'w');
  }
  writeln(line = ''): void {
    fs.writeSync(this.fd, line + '\n');
  }
  close(): void {
    fs.closeSync(this.fd);
  }
}

/**
 * No-op transcript (Null Object). Used when transcript logging is disabled:
 * every `writeln` / `close` does nothing and — unlike {@link BackupLog} — the
 * constructor touches no filesystem, so a disabled run leaves no `logs/backup/`
 * directory or empty file behind. The backup pass itself runs unchanged.
 */
export class NullBackupLog implements BackupTranscript {
  writeln(): void {
    // intentionally empty — transcript logging is disabled
  }
  close(): void {
    // intentionally empty — transcript logging is disabled
  }
}
