/**
 * Translate outbound HTTP failures from a timeline read into the shared
 * {@link XFeedError} taxonomy.
 *
 * Duck-typed on the axios error shape (`code` for transport failures,
 * `response.status` for HTTP responses) rather than `axios.isAxiosError`,
 * which an auto-mocked `axios` neuters in unit tests — the same approach
 * as `infra/link-preview/error-translator.ts` and
 * `infra/llm/selfhosted-client.ts`. The original error survives as
 * `cause` for observability.
 */
import { XFeedError, type XFeedErrorCode } from '../../core/errors';

import type { XFeedFailure } from './types';

/** Operation tag carried on every error a timeline read emits. */
const OPERATION = 'FxTwitterTimelineSource.fetchTimeline';

interface NormalisedHttpError {
  /** HTTP status code, when the request reached the server. */
  readonly status: number | undefined;
  /** Transport-level code (e.g. `ECONNABORTED`, `ENOTFOUND`). */
  readonly transportCode: string | undefined;
}

const normalise = (e: unknown): NormalisedHttpError => {
  const errObj = (e ?? {}) as { code?: unknown; response?: { status?: unknown } };
  return {
    status: typeof errObj.response?.status === 'number' ? errObj.response.status : undefined,
    transportCode: typeof errObj.code === 'string' ? errObj.code : undefined,
  };
};

const codeFor = (n: NormalisedHttpError): XFeedErrorCode => {
  // `ECONNABORTED` is axios's own inactivity timeout and `ETIMEDOUT` the
  // socket-level one; `ERR_CANCELED` is what axios reports when the
  // absolute-deadline `AbortSignal` fires. All three mean "too slow".
  if (
    n.transportCode === 'ECONNABORTED' ||
    n.transportCode === 'ETIMEDOUT' ||
    n.transportCode === 'ERR_CANCELED'
  ) {
    return 'X_FEED_TIMEOUT';
  }
  // 404 is the "handle does not exist" signal — renamed, suspended, or a
  // config typo. It stays broken until an operator edits the config, so
  // it is coded apart from the transient failures above and below.
  if (n.status === 404) return 'X_FEED_NOT_FOUND';
  if (n.status === 429) return 'X_FEED_RATE_LIMITED';
  if (typeof n.status === 'number' && n.status >= 500) return 'X_FEED_UPSTREAM_5XX';
  return 'X_FEED_FETCH_FAILED';
};

const messageKeyFor = (code: XFeedErrorCode): string => {
  switch (code) {
    case 'X_FEED_TIMEOUT':
      return 'errors:x_feed.timeout';
    case 'X_FEED_RATE_LIMITED':
      return 'errors:x_feed.rate_limited';
    case 'X_FEED_UPSTREAM_5XX':
      return 'errors:x_feed.upstream_failure';
    case 'X_FEED_NOT_FOUND':
      return 'errors:x_feed.not_found';
    case 'X_FEED_INVALID_RESPONSE':
      return 'errors:x_feed.invalid_response';
    case 'X_FEED_FETCH_FAILED':
      return 'errors:x_feed.fetch_failed';
    default: {
      // Exhaustiveness guard: a new XFeedErrorCode without a case above
      // becomes a compile error here rather than silently falling back.
      const exhaustive: never = code;
      return exhaustive;
    }
  }
};

const statusLabel = (n: NormalisedHttpError): string => {
  if (typeof n.status === 'number') return String(n.status);
  return n.transportCode ?? 'network';
};

const buildError = (
  handle: string,
  code: XFeedErrorCode,
  status: string,
  cause: unknown,
): XFeedFailure =>
  new XFeedError({
    code,
    messageKey: messageKeyFor(code),
    messageParams: { handle, status },
    context: { operation: OPERATION, input: { handle, status } },
    cause,
  });

/** Translate a thrown HTTP/transport error into an {@link XFeedError}. */
export const translateXFeedError = (handle: string, e: unknown): XFeedFailure => {
  const n = normalise(e);
  return buildError(handle, codeFor(n), statusLabel(n), e);
};

/**
 * Construct the "responded 200 but the body did not match the expected
 * schema" error. No HTTP error was thrown, so the translator above does
 * not apply.
 */
export const invalidResponseError = (handle: string, cause?: unknown): XFeedFailure =>
  buildError(handle, 'X_FEED_INVALID_RESPONSE', 'invalid_response', cause);

/** Test-only re-export so unit tests can introspect the classifier. */
export const __test = { normalise, codeFor, statusLabel };
