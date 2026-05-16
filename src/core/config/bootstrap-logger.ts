/**
 * Bootstrap logger built from `process.env` reads.
 *
 * Audit C-4: this module replaces `src/core/logger/from-process-env.ts`.
 * It lives under `src/core/config/**` so the `no-restricted-syntax`
 * rule that bans `process.env` reads outside `core/config` does not
 * need an eslint-disable waiver. Functionally identical:
 *
 *   - reads `LOG_LEVEL` / `NODE_ENV`
 *   - validates the level against the typed allowlist
 *   - pretty-prints outside production
 *
 * Used as the lazy IoC Logger factory in `BaseBot.run()` — the
 * factory needs a Logger BEFORE `loadEnv()` runs, so a typed-Env-based
 * logger build is not possible at that point. This bootstrap is
 * intentionally permanent for that reason — the previous file's
 * `TODO(phase-4): delete this module` marker was misleading. The
 * `utils/logger.ts` shim that also relied on this bootstrap was
 * retired in PR-F2 (audit C-6) when handler callsites moved to the
 * `core/logger` helpers directly.
 */
import { createLogger, type Logger, type LogLevel } from '../logger/logger';

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
export const createBootstrapLogger = (base?: Readonly<Record<string, unknown>>): Logger => {
  const level = parseLevel(process.env.LOG_LEVEL);
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  return createLogger({
    level,
    pretty: nodeEnv !== 'production',
    ...(base !== undefined ? { base } : {}),
  });
};
