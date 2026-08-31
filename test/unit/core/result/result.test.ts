import { describe, expect, it } from 'vitest';
import { ConfigurationError, DatabaseError } from '../../../../src/core/errors';
import {
  andThen,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrap,
  unwrapOr,
} from '../../../../src/core/result';

const buildErr = (): DatabaseError =>
  new DatabaseError({
    code: 'DATABASE_TIMEOUT',
    messageKey: 'errors:db.timeout',
    context: { operation: 'test' },
  });

describe('Result', () => {
  it('ok / err produce frozen objects with the correct discriminant', () => {
    const o = ok(42);
    expect(o.ok).toBe(true);
    expect(o.value).toBe(42);
    expect(Object.isFrozen(o)).toBe(true);

    const e = err(buildErr());
    expect(e.ok).toBe(false);
    expect(Object.isFrozen(e)).toBe(true);
  });

  it('isOk / isErr narrow correctly', () => {
    const o = ok('x');
    const e = err(buildErr());
    expect(isOk(o)).toBe(true);
    expect(isErr(o)).toBe(false);
    expect(isOk(e)).toBe(false);
    expect(isErr(e)).toBe(true);
  });

  it('map transforms only the success channel', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    const e = buildErr();
    expect(map(err(e), (n: number) => n * 3)).toEqual({ ok: false, error: e });
  });

  it('mapErr transforms only the error channel', () => {
    const a = buildErr();
    const replaced = mapErr(
      err(a),
      () =>
        new ConfigurationError({
          code: 'MISSING_ENV',
          messageKey: 'errors:configuration.missing_env',
          context: { operation: 'test' },
        }),
    );
    expect(isErr(replaced) && replaced.error).toBeInstanceOf(ConfigurationError);
    const v = mapErr(ok(1), () => buildErr());
    expect(isOk(v) && v.value).toBe(1);
  });

  it('andThen chains success', () => {
    const r = andThen(ok(2), (n) => ok(n + 1));
    expect(isOk(r) && r.value).toBe(3);
    const e = andThen(err(buildErr()), () => ok('never'));
    expect(isErr(e)).toBe(true);
  });

  it('unwrapOr returns fallback on Err', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
    expect(unwrapOr(err(buildErr()), 0 as number)).toBe(0);
  });

  it('unwrap throws on Err (test-only escape hatch)', () => {
    expect(unwrap(ok('y'))).toBe('y');
    expect(() => unwrap(err(buildErr()))).toThrowError(DatabaseError);
  });
});
