/**
 * Unit tests for the x-feed error classifier.
 *
 * Driven through the `__test` seam so each branch and each catalog
 * mapping is pinned directly. Reaching the classifier only through
 * `FxTwitterTimelineSource` leaves most of it uncovered: those tests
 * assert `.code` for a handful of statuses and never look at the
 * `messageKey`, so a swapped mapping would render the wrong operator
 * message with the whole suite green.
 */
import { describe, expect, it } from 'vitest';

import {
  __test,
  invalidResponseError,
  translateXFeedError,
} from '../../../../src/infra/x-feed/error-translator';
import { XFeedError, type XFeedErrorCode } from '../../../../src/core/errors';

const { normalise, codeFor, statusLabel } = __test;

const HANDLE = 'someaccount';

const httpError = (status: number): unknown =>
  Object.assign(new Error(`HTTP ${String(status)}`), { response: { status } });

const transportError = (code: string): unknown => Object.assign(new Error(code), { code });

describe('normalise', () => {
  it('extracts a nested HTTP status', () => {
    expect(normalise(httpError(503))).toEqual({ status: 503, transportCode: undefined });
  });

  it('extracts a transport code', () => {
    expect(normalise(transportError('ECONNRESET'))).toEqual({
      status: undefined,
      transportCode: 'ECONNRESET',
    });
  });

  it.each([null, undefined, 'a string', 42])('tolerates the non-object value %s', (value) => {
    expect(normalise(value)).toEqual({ status: undefined, transportCode: undefined });
  });

  it('ignores a non-numeric status and a non-string code', () => {
    expect(normalise({ response: { status: '500' }, code: 7 })).toEqual({
      status: undefined,
      transportCode: undefined,
    });
  });
});

describe('codeFor', () => {
  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'])(
    'classifies the transport code %s as a timeout',
    (transportCode) => {
      expect(codeFor({ status: undefined, transportCode })).toBe('X_FEED_TIMEOUT');
    },
  );

  it.each([
    [404, 'X_FEED_NOT_FOUND'],
    [429, 'X_FEED_RATE_LIMITED'],
    [500, 'X_FEED_UPSTREAM_5XX'],
    [503, 'X_FEED_UPSTREAM_5XX'],
    [400, 'X_FEED_FETCH_FAILED'],
    [403, 'X_FEED_FETCH_FAILED'],
  ])('classifies HTTP %i as %s', (status, expected) => {
    expect(codeFor({ status, transportCode: undefined })).toBe(expected);
  });

  it('prefers the timeout classification over the status', () => {
    // An aborted request can still carry a partial response; the timeout
    // is the more actionable diagnosis.
    expect(codeFor({ status: 500, transportCode: 'ECONNABORTED' })).toBe('X_FEED_TIMEOUT');
  });

  it('falls back to fetch-failed with neither a status nor a code', () => {
    expect(codeFor({ status: undefined, transportCode: undefined })).toBe('X_FEED_FETCH_FAILED');
  });
});

describe('statusLabel', () => {
  it('prefers the numeric status', () => {
    expect(statusLabel({ status: 404, transportCode: 'ECONNRESET' })).toBe('404');
  });

  it('falls back to the transport code', () => {
    expect(statusLabel({ status: undefined, transportCode: 'ENOTFOUND' })).toBe('ENOTFOUND');
  });

  it('labels a bare failure as `network`', () => {
    expect(statusLabel({ status: undefined, transportCode: undefined })).toBe('network');
  });
});

describe('translateXFeedError', () => {
  it.each<[number, XFeedErrorCode, string]>([
    [404, 'X_FEED_NOT_FOUND', 'errors:x_feed.not_found'],
    [429, 'X_FEED_RATE_LIMITED', 'errors:x_feed.rate_limited'],
    [502, 'X_FEED_UPSTREAM_5XX', 'errors:x_feed.upstream_failure'],
    [400, 'X_FEED_FETCH_FAILED', 'errors:x_feed.fetch_failed'],
  ])('maps HTTP %i to %s with its own catalog key', (status, code, messageKey) => {
    const error = translateXFeedError(HANDLE, httpError(status));
    expect(error.code).toBe(code);
    expect(error.messageKey).toBe(messageKey);
  });

  it('maps a timeout to its own catalog key', () => {
    const error = translateXFeedError(HANDLE, transportError('ETIMEDOUT'));
    expect(error.code).toBe('X_FEED_TIMEOUT');
    expect(error.messageKey).toBe('errors:x_feed.timeout');
  });

  it('carries the handle, the status label, the operation, and the cause', () => {
    const cause = httpError(503);
    const error = translateXFeedError(HANDLE, cause);

    expect(error.messageParams).toEqual({ handle: HANDLE, status: '503' });
    expect(error.context.operation).toBe('FxTwitterTimelineSource.fetchTimeline');
    expect(error.context.input).toEqual({ handle: HANDLE, status: '503' });
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(XFeedError);
  });
});

describe('invalidResponseError', () => {
  it('uses the invalid-response code and key', () => {
    const error = invalidResponseError(HANDLE);
    expect(error.code).toBe('X_FEED_INVALID_RESPONSE');
    expect(error.messageKey).toBe('errors:x_feed.invalid_response');
    expect(error.messageParams).toEqual({ handle: HANDLE, status: 'invalid_response' });
  });

  it('preserves an optional cause, such as a zod error', () => {
    const cause = new Error('zod said no');
    expect(invalidResponseError(HANDLE, cause).cause).toBe(cause);
  });
});
