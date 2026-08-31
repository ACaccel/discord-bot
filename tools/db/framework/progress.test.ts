/**
 * Unit suite for the shared progress writer. Ported from the standalone
 * `verify_db` tool's `createProgressWriter` coverage.
 */
import { describe, expect, it } from 'vitest';

import { createProgressWriter } from './progress';

describe('db / createProgressWriter', () => {
  const collectSink = (): { sink: { write: (text: string) => void }; out: string[] } => {
    const out: string[] = [];
    return { sink: { write: (text: string): void => void out.push(text) }, out };
  };

  it('TTY mode rewrites the same line with \\r + clear-line escape', () => {
    const { sink, out } = collectSink();
    const writer = createProgressWriter(sink, true);
    writer('step 1', false);
    writer('step 1 done', true);
    expect(out).toEqual(['\r\x1b[2Kstep 1', '\r\x1b[2Kstep 1 done\n']);
  });

  it('non-TTY mode appends a newline per write and never emits escape codes', () => {
    const { sink, out } = collectSink();
    const writer = createProgressWriter(sink, false);
    writer('step 1', false);
    writer('step 1 done', true);
    expect(out).toEqual(['step 1\n', 'step 1 done\n']);
    for (const line of out) {
      expect(line).not.toContain('\r');
      expect(line).not.toContain('\x1b');
    }
  });
});
