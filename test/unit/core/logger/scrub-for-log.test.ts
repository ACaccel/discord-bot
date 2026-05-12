import { describe, expect, it } from 'vitest';
import { scrubForLog } from '../../../../src/core/logger/scrub-for-log';

describe('scrubForLog', () => {
  it('passes scalars through unchanged', () => {
    expect(scrubForLog('hi')).toBe('hi');
    expect(scrubForLog(42)).toBe(42);
    expect(scrubForLog(true)).toBe(true);
    expect(scrubForLog(null)).toBe(null);
    expect(scrubForLog(undefined)).toBe(undefined);
  });

  it('replaces top-level sensitive field values with [Redacted]', () => {
    const out = scrubForLog({
      bot: 'b1',
      token: 'secret-token',
      apiKey: 'sk-123',
      mongoURI: 'mongodb://user:pw@host',
      okField: 'visible',
    }) as Record<string, unknown>;
    expect(out.token).toBe('[Redacted]');
    expect(out.apiKey).toBe('[Redacted]');
    expect(out.mongoURI).toBe('[Redacted]');
    expect(out.bot).toBe('b1');
    expect(out.okField).toBe('visible');
  });

  it('redacts case-insensitively', () => {
    const out = scrubForLog({ Authorization: 'Bearer x', TOKEN: 'y' }) as Record<string, unknown>;
    expect(out.Authorization).toBe('[Redacted]');
    expect(out.TOKEN).toBe('[Redacted]');
  });

  it('redacts nested sensitive fields', () => {
    const out = scrubForLog({
      req: { headers: { authorization: 'Bearer x', 'x-api-key': 'k' } },
    }) as { req: { headers: Record<string, unknown> } };
    expect(out.req.headers.authorization).toBe('[Redacted]');
    expect(out.req.headers['x-api-key']).toBe('[Redacted]');
  });

  it('reshapes Error instances to drop ad-hoc fields (axios config etc.)', () => {
    const e = new Error('boom') as Error & {
      config?: { headers?: { authorization?: string } };
      code?: string;
    };
    e.code = 'EAUTH';
    e.config = { headers: { authorization: 'Bearer secret' } };
    const out = scrubForLog(e) as Record<string, unknown>;
    expect(out.name).toBe('Error');
    expect(out.message).toBe('boom');
    expect(out.code).toBe('EAUTH');
    expect('config' in out).toBe(false);
  });

  it('recurses into Error.cause (ES2022)', () => {
    const root = new Error('root cause') as Error & { token?: string };
    root.token = 'should-not-leak';
    const wrapper = new Error('wrap', { cause: root });
    const out = scrubForLog(wrapper) as { cause: Record<string, unknown> };
    expect(out.cause.name).toBe('Error');
    expect(out.cause.message).toBe('root cause');
    // `token` is an ad-hoc Error field and is dropped by the Error
    // unwrap shape (not even passed through redaction — Error unwrap
    // is strict whitelist).
    expect('token' in out.cause).toBe(false);
  });

  it('handles arrays by recursing element-wise', () => {
    const out = scrubForLog([{ token: 'x' }, { ok: 'visible' }]) as Array<Record<string, unknown>>;
    expect(out[0]?.token).toBe('[Redacted]');
    expect(out[1]?.ok).toBe('visible');
  });

  it('caps recursion depth so a cyclic-style deep tree does not blow up', () => {
    // Build a 6-deep nested object; depths beyond MAX_DEPTH (4) collapse
    // to '[Redacted]'.
    type Nest = { next?: Nest; leaf?: string };
    const deep: Nest = {};
    let cursor: Nest = deep;
    for (let i = 0; i < 6; i++) {
      cursor.next = {};
      cursor = cursor.next;
    }
    cursor.leaf = 'sentinel';
    const out = scrubForLog(deep);
    // Walking 5 levels of `next` should still find leaves; level 5+
    // collapses.
    expect(out).toBeDefined();
    expect(JSON.stringify(out).includes('[Redacted]')).toBe(true);
  });

  it('drops functions to a placeholder', () => {
    const out = scrubForLog({ fn: () => 1, name: 'visible' }) as Record<string, unknown>;
    expect(out.fn).toBe('[Redacted]');
    expect(out.name).toBe('visible');
  });
});
