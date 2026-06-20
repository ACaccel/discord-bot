/**
 * Report emission shared by every command.
 *
 * Serializes the JSON report to the configured `output_path` (or stdout
 * when unset), then writes the human-readable summary line to stdout so
 * the PASS / FAIL / RECOMMENDATION verdict is always visible even when
 * the report itself is redirected to a file.
 */
import { writeFileSync } from 'node:fs';

import type { Logger } from '../../../src/core/logger';

export const emitReport = (
  report: unknown,
  summaryLine: string,
  outputPath: string | null,
  logger: Logger,
): void => {
  const serialised = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath !== null) {
    writeFileSync(outputPath, serialised, 'utf8');
    logger.info({ outputPath }, 'db: report written');
  } else {
    process.stdout.write(serialised);
  }
  process.stdout.write(`${summaryLine}\n`);
};
