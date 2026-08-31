/**
 * Shared NDJSON test helpers.
 *
 * Multiple modules (env loader, future logger) emit NDJSON to stderr.
 * Importing a single capture/parse helper from here keeps the asserted
 * shape consistent across layers; if the wire format ever changes the
 * test suite breaks in one place instead of dozens.
 */
import { vi, type MockInstance } from 'vitest';

interface NdjsonLine {
  readonly level: number;
  readonly levelLabel?: string;
  readonly event: string;
  readonly pid?: number;
  readonly time?: number;
  readonly [key: string]: unknown;
}

interface NdjsonCapture {
  readonly lines: () => NdjsonLine[];
  readonly restore: () => void;
  readonly spy: MockInstance<typeof process.stderr.write>;
}

/**
 * Spy on `process.stderr.write` and parse every call as one or more
 * NDJSON lines. Returns a capture handle whose `lines()` method yields
 * the parsed records (objects skipped if they fail JSON.parse — letting
 * the test ignore non-JSON noise from other writers).
 */
export const captureStderrNdjson = (): NdjsonCapture => {
  const collected: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((
    chunk: Uint8Array | string,
  ) => {
    collected.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as unknown as typeof process.stderr.write);

  return {
    lines: () => {
      const out: NdjsonLine[] = [];
      for (const chunk of collected) {
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          try {
            out.push(JSON.parse(trimmed) as NdjsonLine);
          } catch {
            // Skip non-JSON lines (e.g. TTY-only pretty summaries).
          }
        }
      }
      return out;
    },
    restore: () => spy.mockRestore(),
    spy,
  };
};
