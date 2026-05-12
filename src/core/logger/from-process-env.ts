/**
 * Transitional logger bootstrap.
 *
 * Reads `LOG_LEVEL` and `NODE_ENV` directly from `process.env` so the
 * legacy `src/utils/logger.ts` shim and the still-process.env-reading
 * bot entrypoints (`src/bot/<name>/index.ts`) can obtain a structured
 * logger without first plumbing the typed `Env` from
 * `src/core/config/env.ts`. This is the **only** module outside
 * `src/core/config/**` permitted to touch `process.env`; an
 * eslint-disable inline marker pins that policy.
 *
 * Phase 4 will migrate bot entrypoints to load `Env` explicitly and
 * call {@link createLogger} directly with the typed level. This file
 * will then be deleted.
 *
 * TODO(phase-4): delete this module after the env-typed bootstrap
 * lands. Removing it also drops the two `eslint-disable` markers
 * below — those policy waivers are *temporary*.
 */
import { createLogger, type Logger, type LogLevel } from './logger';

const VALID_LEVELS = new Set<LogLevel>([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);

const parseLevel = (raw: string | undefined): LogLevel => {
  if (raw === undefined) return 'info';
  return VALID_LEVELS.has(raw as LogLevel) ? (raw as LogLevel) : 'info';
};

/**
 * Build a root {@link Logger} from `process.env.LOG_LEVEL` /
 * `process.env.NODE_ENV`. Pretty-print is enabled outside production.
 */
export const createLoggerFromProcessEnv = (base?: Readonly<Record<string, unknown>>): Logger => {
  // eslint-disable-next-line no-restricted-syntax -- transitional bootstrap; see file header
  const level = parseLevel(process.env.LOG_LEVEL);
  // eslint-disable-next-line no-restricted-syntax -- transitional bootstrap; see file header
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  return createLogger({
    level,
    pretty: nodeEnv !== 'production',
    ...(base !== undefined ? { base } : {}),
  });
};
