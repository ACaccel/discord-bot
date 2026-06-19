import { describe, expect, it } from 'vitest';

import { isTransientNetworkError } from '../../../../src/core/errors';

describe('isTransientNetworkError', () => {
  it.each([
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ECONNREFUSED',
    'ECONNABORTED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
  ])('returns true for whitelisted network error code %s', (code) => {
    expect(isTransientNetworkError(Object.assign(new Error('boom'), { code }))).toBe(true);
  });

  it('returns true for a "socket hang up" message with no code', () => {
    expect(isTransientNetworkError(new Error('socket hang up'))).toBe(true);
  });

  it('matches the "socket hang up" message case-insensitively', () => {
    expect(isTransientNetworkError(new Error('Socket Hang Up'))).toBe(true);
  });

  it.each([new TypeError('bad arg'), new RangeError('out of range'), new Error('plain failure')])(
    'returns false for non-network errors (%s)',
    (err) => {
      expect(isTransientNetworkError(err)).toBe(false);
    },
  );

  it('returns false for an unknown error code', () => {
    expect(isTransientNetworkError(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false);
  });

  it('returns false for non-Error values that merely look network-shaped', () => {
    expect(isTransientNetworkError('ECONNRESET')).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
  });
});
