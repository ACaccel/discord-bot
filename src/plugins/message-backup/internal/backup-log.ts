/**
 * Append-only newline-terminated log file used by the message-backup
 * plugin to mirror the per-guild backup transcript that ops dashboards
 * grep. Synchronous fs.writeSync — guarantees the line lands even if
 * the process is signalled mid-backup. Caller is responsible for
 * calling `close()` in a `finally`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export class BackupLog {
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
