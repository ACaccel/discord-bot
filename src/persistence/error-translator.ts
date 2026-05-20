/**
 * Translate raw mongoose / MongoDB driver errors into typed
 * {@link DatabaseError} instances.
 *
 * Lives in `persistence/` (not `core/errors`, and no longer in
 * `infra/mongo`) so that `core/` stays free of mongoose imports and
 * the seven repositories can reach the translator without an upward
 * import into `infra/mongo` (gap G-2). The translation here is pure
 * string-shape inspection and carries no mongoose import itself; the
 * boundary is upheld at the type level by the layer contract.
 *
 * Sub-code mapping:
 *   - `DATABASE_DUPLICATE_KEY` — MongoServerError code 11000.
 *   - `DATABASE_TIMEOUT`        — MongooseError name `MongooseServerSelectionError`,
 *     MongoNetworkTimeoutError, or any err whose message contains
 *     `'timeout'` (case-insensitive).
 *   - `DATABASE_NETWORK`        — MongoNetworkError (non-timeout).
 *   - `DATABASE_VALIDATION`     — mongoose `ValidationError` / `CastError`.
 *   - `DATABASE_UNKNOWN`        — anything else; do not swallow, surface
 *     so logs carry the original `cause`.
 *
 * The translation is intentionally string-shape-based (duck-typed) so
 * mongoose version bumps don't require a coordinated upgrade — we
 * inspect `name` + `code` + `message` rather than `instanceof`.
 */
import { DatabaseError, type DatabaseErrorCode } from '../core/errors/external-service-error';
import type { ErrorContext } from '../core/errors/error-context';

interface MongoLikeError {
  readonly name?: string;
  readonly message?: string;
  readonly code?: number | string;
}

const classify = (raw: unknown): DatabaseErrorCode => {
  if (typeof raw !== 'object' || raw === null) return 'DATABASE_UNKNOWN';
  const e = raw as MongoLikeError;
  const code = e.code;
  const name = e.name ?? '';
  const message = e.message ?? '';
  // 11000 is the well-known duplicate-key code; mongoose preserves it
  // on the wrapped error.
  if (code === 11000 || code === '11000') return 'DATABASE_DUPLICATE_KEY';
  if (name === 'ValidationError' || name === 'CastError') return 'DATABASE_VALIDATION';
  // ServerSelection covers "could not pick a primary in time" — the
  // most common timeout shape from the driver.
  if (
    name === 'MongooseServerSelectionError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkTimeoutError' ||
    // Two patterns intentionally: `/timeout/i` matches the continuous
    // word ("timeout"); `/\btimed?\s*out\b/i` also covers the spaced
    // variant ("timed out"). Mongo error messages use both.
    /timeout/i.test(message) ||
    /\btimed?\s*out\b/i.test(message)
  ) {
    return 'DATABASE_TIMEOUT';
  }
  if (name === 'MongoNetworkError' || /ECONNREFUSED|ENOTFOUND|ECONNRESET/.test(message)) {
    return 'DATABASE_NETWORK';
  }
  return 'DATABASE_UNKNOWN';
};

const i18nKeyFor = (code: DatabaseErrorCode): string => {
  switch (code) {
    case 'DATABASE_DUPLICATE_KEY':
      return 'errors.db.duplicate_key';
    case 'DATABASE_TIMEOUT':
      return 'errors.db.timeout';
    case 'DATABASE_NETWORK':
      return 'errors.db.network';
    case 'DATABASE_VALIDATION':
      return 'errors.db.validation';
    case 'DATABASE_UNKNOWN':
      return 'errors.db.unavailable';
  }
};

/**
 * Wrap a raw mongoose / driver error as a typed {@link DatabaseError}.
 *
 * `context.operation` is required (per ErrorContext contract); pass
 * the full `"<Class>.<method>"` shape the rest of the codebase uses.
 */
export const databaseErrorFrom = (raw: unknown, context: ErrorContext): DatabaseError => {
  const code = classify(raw);
  return new DatabaseError({
    code,
    messageKey: i18nKeyFor(code),
    context,
    cause: raw,
  });
};

/** Test-only export so unit tests can pin the classifier without going through `databaseErrorFrom`. */
export const __classifyMongoErrorForTests = classify;
