/**
 * Logger smoke test.
 *
 * The pino stack itself is a well-tested third-party module; what we
 * verify here is the project-specific glue:
 *   - createLogger returns an object honouring our `Logger` shape
 *   - child loggers compose
 *   - redact path list includes the project's banned field names
 *
 * Output-stream assertions (does pino actually print JSON?) are pino's
 * job, not ours.
 */
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../../src/core/logger';
import { REDACT_FIELD_NAMES, buildPinoRedactPaths } from '../../../../src/core/config/redact';

describe('createLogger', () => {
  it('returns an object with the documented Logger surface', () => {
    const l = createLogger({ level: 'silent', pretty: false });
    for (const method of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'child'] as const) {
      expect(typeof l[method]).toBe('function');
    }
  });

  it('child() returns a logger that itself supports child()', () => {
    const root = createLogger({ level: 'silent', pretty: false });
    const a = root.child({ bot: 'b1' });
    const b = a.child({ guildId: 'g1' });
    expect(typeof b.child).toBe('function');
    expect(typeof b.info).toBe('function');
  });
});

describe('redact path catalog', () => {
  it('covers every banned field name with depth-0..3 wildcards', () => {
    const paths = buildPinoRedactPaths();
    for (const name of REDACT_FIELD_NAMES) {
      expect(paths).toContain(name);
      expect(paths).toContain(`*.${name}`);
      expect(paths).toContain(`*.*.${name}`);
      expect(paths).toContain(`*.*.*.${name}`);
    }
  });
});
