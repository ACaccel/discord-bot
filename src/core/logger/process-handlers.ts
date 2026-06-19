/**
 * Process-level safety net.
 *
 * `uncaughtException`: a transient outbound-socket failure (e.g. a
 * gateway `ECONNRESET` / "socket hang up") is downgraded — logged at
 * error level, counted, and tolerated, because a connectivity blip does
 * not corrupt process state and the owning client reconnects on its own.
 * Every other uncaught exception is treated as fatal: log + best-effort
 * graceful shutdown with a hard 5-second timeout, then `process.exit(1)`.
 * Letting Node continue past a genuine fault is footgun territory — the
 * process is in an indeterminate state. The transient whitelist is kept
 * deliberately narrow (see {@link isTransientNetworkError}) so real
 * defects still crash loudly. The count is surfaced via
 * {@link getTransientNetworkErrorCount} for /health.
 *
 * `unhandledRejection`: log + counter increment. Do NOT exit; many
 * libraries fire-and-forget promises that reject benignly during
 * teardown. The count is surfaced via {@link getUnhandledRejectionCount}
 * so a /health endpoint can read it.
 *
 * Installation is idempotent at the module level via {@link installed}.
 * Multi-bot processes (one node process running >1 BaseBot) get a
 * single shared installation.
 */
import { isTransientNetworkError } from '../errors';

import type { Logger } from './logger';

let installed = false;
let unhandledRejectionCount = 0;
let transientNetworkErrorCount = 0;
let shuttingDown = false;

export interface InstallProcessHandlersInput {
  readonly logger: Logger;
  /**
   * Called when uncaughtException fires. Implementations should close
   * Discord clients + mongo connections etc. The handler enforces a
   * 5-second cap before calling `process.exit(1)`.
   */
  readonly gracefulShutdown: () => Promise<void>;
}

const SHUTDOWN_HARD_TIMEOUT_MS = 5_000;

export const installProcessHandlers = (input: InstallProcessHandlersInput): void => {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    unhandledRejectionCount += 1;
    input.logger.error(
      {
        err: reason instanceof Error ? reason : new Error(String(reason)),
        promise: String(promise),
        unhandledRejectionCount,
      },
      'unhandledRejection',
    );
  });

  process.on('uncaughtException', (err: Error) => {
    // A transient outbound-socket failure can surface here when an
    // EventEmitter (e.g. discord.js's gateway) emits 'error' with no
    // listener: Node rethrows it as an uncaughtException. The process
    // state is not corrupted by a connectivity blip, so log it and keep
    // running — the owning client reconnects itself. The whitelist is
    // narrow so genuine defects still fall through to the fatal path.
    if (isTransientNetworkError(err)) {
      transientNetworkErrorCount += 1;
      input.logger.error(
        { err, transientNetworkErrorCount },
        'uncaughtException: transient network error; not shutting down',
      );
      return;
    }
    input.logger.fatal({ err }, 'uncaughtException; initiating graceful shutdown');
    // Re-entrancy guard: a secondary uncaughtException while shutdown
    // is already running should NOT arm a second timer or kick off a
    // second shutdown attempt. The first timer + finally will still
    // force-exit within SHUTDOWN_HARD_TIMEOUT_MS.
    if (shuttingDown) return;
    shuttingDown = true;
    const timer = setTimeout(() => {
      input.logger.fatal(
        { timeoutMs: SHUTDOWN_HARD_TIMEOUT_MS },
        'graceful shutdown hit hard timeout; forcing exit',
      );
      process.exit(1);
    }, SHUTDOWN_HARD_TIMEOUT_MS);
    // Defensive: do not let the timer keep the process alive longer than necessary.
    timer.unref?.();

    // `Promise.resolve().then(...)` normalises a synchronous throw
    // inside `gracefulShutdown` into a rejected promise so the
    // `.catch` arm always runs — without this, a sync throw would
    // bypass `.catch` and only the hard-timeout would force the exit.
    Promise.resolve()
      .then(() => input.gracefulShutdown())
      .catch((shutdownErr: unknown) => {
        input.logger.fatal(
          { err: shutdownErr instanceof Error ? shutdownErr : new Error(String(shutdownErr)) },
          'graceful shutdown threw; forcing exit',
        );
      })
      .finally(() => {
        clearTimeout(timer);
        process.exit(1);
      });
  });
};

/** Test-only — reset module state between cases. */
export const __resetProcessHandlersForTests = (): void => {
  installed = false;
  unhandledRejectionCount = 0;
  transientNetworkErrorCount = 0;
  shuttingDown = false;
};

export const getUnhandledRejectionCount = (): number => unhandledRejectionCount;

/**
 * Count of `uncaughtException`s that were downgraded as transient
 * network blips (logged + tolerated rather than fatal). Surfaced for a
 * /health endpoint so operators can see connectivity churn.
 */
export const getTransientNetworkErrorCount = (): number => transientNetworkErrorCount;
