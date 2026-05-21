/**
 * Structured logger built on pino.
 *
 * Design points:
 *   - One {@link Logger} interface, structurally compatible with pino's
 *     own logger so we can hand a pino instance straight back to it,
 *     while leaving room for an in-memory fake in tests.
 *   - Redact path list is derived from `src/core/config/redact.ts`
 *     (single source of truth shared with the env loader).
 *   - Child loggers compose: bot-scoped → guild-scoped →
 *     interaction-scoped (with `traceId`). The InteractionRouter
 *     generates the `traceId` value and binds it on the child logger.
 *     Do NOT introduce AsyncLocalStorage to push traceId through the
 *     call stack — handlers receive their child logger explicitly via
 *     the interaction context.
 *   - `err()` accepts a DomainError or any unknown thrown value; pino's
 *     default error serialiser preserves stack + `cause`. We additionally
 *     log the DomainError JSON shape under the `err` key so structured
 *     consumers see `kind`, `code`, `messageKey`, etc.
 *
 * Boot order:
 *   env loader runs first (writes JSON to stderr directly — no logger
 *   dependency). Logger initialises after env is parsed because it
 *   reads LOG_LEVEL and NODE_ENV. See `src/core/config/env.ts` header
 *   for the contract.
 */
import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { buildPinoRedactPaths } from '../config/redact';
import { scrubForLog } from './scrub-for-log';

/**
 * Application-facing logger surface. A subset of pino's API — keeping
 * it small means tests can fake it without re-implementing pino.
 */
export interface Logger {
  trace(obj: object, msg?: string): void;
  trace(msg: string): void;
  debug(obj: object, msg?: string): void;
  debug(msg: string): void;
  info(obj: object, msg?: string): void;
  info(msg: string): void;
  warn(obj: object, msg?: string): void;
  warn(msg: string): void;
  error(obj: object, msg?: string): void;
  error(msg: string): void;
  fatal(obj: object, msg?: string): void;
  fatal(msg: string): void;
  /**
   * Create a child logger that automatically includes `bindings` on
   * every line. Used for scope propagation
   * (`root.child({ bot }).child({ guildId }).child({ traceId })`).
   */
  child(bindings: Readonly<Record<string, unknown>>): Logger;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export interface CreateLoggerInput {
  /** pino level. Validated upstream by env schema. */
  readonly level: LogLevel;
  /** When true, route through pino-pretty for human-readable dev output. */
  readonly pretty: boolean;
  /** Bound on every line (e.g. `{ env: 'production', service: 'discord-bot' }`). */
  readonly base?: Readonly<Record<string, unknown>>;
}

/**
 * Build the root logger for a process. Called exactly once per bot
 * process from `BaseBot.run()` (or test setup). Subsequent scope
 * narrowing happens via `.child()`.
 */
export const createLogger = (input: CreateLoggerInput): Logger => {
  const options: LoggerOptions = {
    level: input.level,
    base: input.base ?? null, // null = drop default { pid, hostname } noise
    redact: {
      paths: [...buildPinoRedactPaths()],
      remove: false, // mask with [Redacted] so absence is visible in logs
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  // pino-pretty is only loaded at runtime when `pretty: true`. The
  // dependency is dev-only; production logs land as JSON lines.
  if (input.pretty) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    };
  }
  const root: PinoLogger = pino(options);
  return wrap(root);
};

/**
 * Adapt a pino logger to our {@link Logger} interface. Keeps the rest
 * of the codebase from importing pino types directly.
 *
 * Every object argument is passed through {@link scrubForLog} before
 * reaching pino. This is **redundant** with pino's `redact.paths`
 * (configured in {@link createLogger}) — it exists to give CodeQL's
 * taint analysis an explicit sanitisation step it can recognise on
 * `js/clear-text-logging`, AND as defense-in-depth against a future
 * redact-path misconfiguration. See `scrub-for-log.ts` header.
 */
const wrap = (p: PinoLogger): Logger => {
  type LogFn = (obj: object, msg?: string) => void;
  type StringLogFn = (msg: string) => void;
  const call =
    (objFn: LogFn, strFn: StringLogFn) =>
    (a: object | string, b?: string): void => {
      if (typeof a === 'string') {
        strFn(a);
        return;
      }
      // scrubForLog deep-clones with sensitive top-level + nested keys
      // replaced by '[Redacted]'. Pino's runtime redact still runs on
      // top of this; the scrub is the static-analysis-visible step.
      const scrubbed = scrubForLog(a) as object;
      objFn(scrubbed, b);
    };
  return {
    trace: call(p.trace.bind(p), p.trace.bind(p)),
    debug: call(p.debug.bind(p), p.debug.bind(p)),
    info: call(p.info.bind(p), p.info.bind(p)),
    warn: call(p.warn.bind(p), p.warn.bind(p)),
    error: call(p.error.bind(p), p.error.bind(p)),
    fatal: call(p.fatal.bind(p), p.fatal.bind(p)),
    child: (bindings) => wrap(p.child(bindings)),
  };
};
