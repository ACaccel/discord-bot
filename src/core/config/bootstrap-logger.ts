/**
 * Bootstrap logger built directly from `process.env` reads.
 *
 * Lives under `src/core/config/**` so the `no-restricted-syntax` rule
 * that bans `process.env` reads outside `core/config` is satisfied
 * without an eslint-disable waiver. It:
 *
 *   - reads `LOG_LEVEL` / `NODE_ENV` / `LOG_DIR`
 *   - validates the level against the typed allowlist
 *   - pretty-prints outside production
 *   - opts into the file-router sink via `createFileSink` (the
 *     composition-root factory in `core/logger/file-router-transport`),
 *     so `createLogger` itself stays free of file-system concerns
 *
 * Used as the lazy IoC Logger factory in `BaseBot.run()`: the factory
 * needs a Logger BEFORE `loadEnv()` runs, so a typed-Env-based logger
 * build is not possible at that point. This bootstrap exists precisely
 * to cover that pre-env window.
 *
 * Note on `NODE_ENV`: the historical `nodeEnv === 'test'` branch that
 * force-disabled the file sink is gone. Tests that need a logger build
 * one with `createLogger({ ... })` directly (no `extraStreams`) and
 * therefore never construct a file sink in the first place — the env
 * detection was dead-defensive code that bled the test environment
 * back into the production code path for no operational benefit.
 */
import { createFileSink, createLogger, type Logger, type LogLevel } from '../logger';

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
 * `process.env.NODE_ENV` / `process.env.LOG_DIR`. Pretty-print is
 * enabled outside production. The file-router sink is enabled whenever
 * `LOG_DIR` resolves to a non-empty string (default `'logs'`); set
 * `LOG_DIR=''` explicitly to disable file output for ephemeral
 * containers that should stay write-free.
 */
export const createBootstrapLogger = (base?: Readonly<Record<string, unknown>>): Logger => {
  const level = parseLevel(process.env.LOG_LEVEL);
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const fileRootDir = process.env.LOG_DIR ?? 'logs';
  // `silent` short-circuits every sink inside `createLogger`, so
  // building a file sink that pino will never write to is a wasted fd.
  const extraStreams =
    fileRootDir.length > 0 && level !== 'silent'
      ? [createFileSink({ rootDir: fileRootDir, level })]
      : [];
  return createLogger({
    level,
    pretty: nodeEnv !== 'production',
    ...(base !== undefined ? { base } : {}),
    extraStreams,
  });
};
