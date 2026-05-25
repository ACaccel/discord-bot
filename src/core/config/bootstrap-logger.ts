/**
 * Bootstrap logger built directly from `process.env` reads.
 *
 * Lives under `src/core/config/**` so the `no-restricted-syntax` rule
 * that bans `process.env` reads outside `core/config` is satisfied
 * without an eslint-disable waiver. It:
 *
 *   - reads `LOG_LEVEL` / `NODE_ENV`
 *   - validates the level against the typed allowlist
 *   - pretty-prints outside production
 *
 * Used as the lazy IoC Logger factory in `BaseBot.run()`: the factory
 * needs a Logger BEFORE `loadEnv()` runs, so a typed-Env-based logger
 * build is not possible at that point. This bootstrap exists precisely
 * to cover that pre-env window.
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
  // `LOG_DIR` is the file-router root. Empty / unset disables the file
  // sink so ephemeral containers stay write-free. The default lands
  // logs at `<cwd>/logs/<botId>[/<guildId>]/<date>.log`. The file
  // transport is also force-disabled under `NODE_ENV=test` so vitest
  // suites that build a real bootstrap logger do not spawn pino worker
  // threads that try to resolve a TypeScript transport entry point
  // through Node's CommonJS resolver.
  const fileRootDirRaw = process.env.LOG_DIR ?? 'logs';
  const fileRootDir = nodeEnv === 'test' ? '' : fileRootDirRaw;
  return createLogger({
    level,
    pretty: nodeEnv !== 'production',
    ...(base !== undefined ? { base } : {}),
    ...(fileRootDir.length > 0 ? { fileRootDir } : {}),
  });
};
