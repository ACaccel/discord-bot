/**
 * Defensive object scrubber applied before any value reaches pino.
 *
 * Pino's `redact.paths` already redacts the same field set at log time
 * (see `src/core/config/redact.ts`), so this scrubber is *redundant
 * with the runtime path*. It exists for two reasons:
 *
 *   1. CodeQL's `js/clear-text-logging` taint analysis cannot model
 *      pino's redact mechanism, so any value derived from a sensitive
 *      env access (e.g. `process.env[PROVIDER_API_KEY_ENV[...]]`)
 *      passed into the logger surface as a plain object would be
 *      flagged as a clear-text logging sink. Applying an explicit
 *      sanitisation step here ensures the static analyser sees the
 *      taint cleared before the pino call site.
 *   2. Defense in depth: a misconfigured pino instance (lost `redact`
 *      paths during a future refactor) would otherwise silently leak.
 *      This module is a second wall.
 *
 * The redact field list is sourced from `core/config/redact.ts` so the
 * scrubber, the pino redact paths, and the env loader all share one
 * authoritative banned-name list.
 */
import { REDACT_FIELD_NAMES } from '../config/redact';

const SENSITIVE_NAMES_LOWER = new Set(REDACT_FIELD_NAMES.map((n) => n.toLowerCase()));
const REPLACEMENT = '[Redacted]';
/** Walk depth cap matches pino's depth coverage in buildPinoRedactPaths. */
const MAX_DEPTH = 4;

type Scalar = string | number | boolean | bigint | null | undefined;

const isPlainScalar = (v: unknown): v is Scalar =>
  v === null ||
  v === undefined ||
  typeof v === 'string' ||
  typeof v === 'number' ||
  typeof v === 'boolean' ||
  typeof v === 'bigint';

/**
 * Return a deep-cloned shape with values at keys in {@link REDACT_FIELD_NAMES}
 * (case-insensitive) replaced by `[Redacted]`. Error instances are
 * unwrapped into `{ name, message, code, stack, cause }` — `cause` is
 * recursed; ad-hoc Error fields (axios `config`, mongoose `requestPath`,
 * etc.) are dropped, eliminating the most common nested-secret carrier.
 */
export const scrubForLog = (value: unknown, depth = 0): unknown => {
  if (depth >= MAX_DEPTH) return REPLACEMENT;
  if (isPlainScalar(value)) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      // `code` is common on Node / Mongoose / driver errors and is not
      // sensitive — preserve it for diagnostics.
      code: (value as Error & { code?: unknown }).code,
      cause: value.cause === undefined ? undefined : scrubForLog(value.cause, depth + 1),
    };
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubForLog(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_NAMES_LOWER.has(k.toLowerCase())) {
        out[k] = REPLACEMENT;
        continue;
      }
      out[k] = scrubForLog(v, depth + 1);
    }
    return out;
  }
  // Functions, symbols, etc. — drop to a stable placeholder.
  return REPLACEMENT;
};
