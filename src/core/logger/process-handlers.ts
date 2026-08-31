/**
 * Process-level safety net.
 *
 * `SIGINT` / `SIGTERM`: the operator's (or the supervisor's) request to
 * stop. Both run the injected `gracefulShutdown` under the same
 * re-entrancy guard and hard timeout as the fatal-exception path, then
 * exit 0 — so a supervisor configured `restart: on-failure` treats an
 * intentional stop as one. Installing them is what makes the graceful
 * path reachable at all: without a listener Node terminates the process
 * immediately on the signal, leaving Mongo connections open, a
 * half-written backup transcript, and a bound HTTP port.
 *
 * A *second* signal while a shutdown is already running is treated as
 * "stop waiting" and exits at once with status 1. That branch cannot
 * distinguish an impatient operator from a supervisor escalating
 * `SIGINT` to `SIGTERM`; both mean the same thing here — the caller is
 * no longer willing to wait, and the teardown did not finish.
 *
 * The exit status only ever escalates. A fatal `uncaughtException` that
 * lands during a clean `SIGTERM` teardown, or a `gracefulShutdown` that
 * throws, raises the eventual status to 1 rather than letting the
 * first-writer's 0 stand.
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
/**
 * Status the process will exit with once the in-flight teardown
 * finishes. Only ever escalated (see {@link escalateExitCode}) so a
 * fault arriving during a clean SIGTERM cannot be reported to the
 * supervisor as a clean stop.
 */
let pendingExitCode = 0;
/** Guards against a second `exit` call on the hard-timeout path. */
let exited = false;

/** Process-termination primitive; `process.exit` in production. */
type ExitFn = (code: number) => void;

interface InstallProcessHandlersInput {
  readonly logger: Logger;
  /**
   * Called when a termination signal or a fatal uncaughtException
   * fires. Implementations should close Discord clients + mongo
   * connections etc. The handler enforces a 5-second cap before
   * calling {@link InstallProcessHandlersInput.exit}.
   */
  readonly gracefulShutdown: () => Promise<void>;
  /**
   * Termination primitive. Defaults to `process.exit`. Injectable so
   * the shutdown paths can be exercised without tearing down the
   * caller's process.
   */
  readonly exit?: ExitFn;
}

const SHUTDOWN_HARD_TIMEOUT_MS = 5_000;

/** Signals that mean "stop this process"; both take the graceful path. */
const TERMINATION_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export const installProcessHandlers = (input: InstallProcessHandlersInput): void => {
  if (installed) return;
  installed = true;

  const rawExit: ExitFn = input.exit ?? ((code) => process.exit(code));
  // `process.exit` never returns, but an injected double does. Guard so
  // the hard-timeout arm and the `finally` arm cannot both terminate.
  const exit: ExitFn = (code) => {
    if (exited) return;
    exited = true;
    rawExit(code);
  };
  const escalateExitCode = (code: number): void => {
    pendingExitCode = Math.max(pendingExitCode, code);
  };

  /**
   * Run `gracefulShutdown` under a hard timeout, then exit with the
   * escalated status. Only the first call owns the timer and the exit;
   * a later trigger still raises {@link pendingExitCode}, so a fatal
   * fault that lands mid-teardown is not reported as a clean stop.
   *
   * `Promise.resolve().then(...)` normalises a synchronous throw inside
   * `gracefulShutdown` into a rejected promise so the `.catch` arm
   * always runs — without this, a sync throw would bypass `.catch` and
   * only the hard timeout would force the exit.
   */
  const beginShutdown = (exitCode: number, event: string): void => {
    escalateExitCode(exitCode);
    if (shuttingDown) return;
    shuttingDown = true;
    const timer = setTimeout(() => {
      input.logger.fatal(
        { timeoutMs: SHUTDOWN_HARD_TIMEOUT_MS, event },
        'graceful shutdown hit hard timeout; forcing exit',
      );
      exit(1);
    }, SHUTDOWN_HARD_TIMEOUT_MS);
    // Defensive: do not let the timer keep the process alive longer than necessary.
    timer.unref?.();

    Promise.resolve()
      .then(() => input.gracefulShutdown())
      .catch((shutdownErr: unknown) => {
        input.logger.fatal(
          {
            err: shutdownErr instanceof Error ? shutdownErr : new Error(String(shutdownErr)),
            event,
          },
          'graceful shutdown threw; forcing exit',
        );
        // Teardown did not complete: the port may still be bound and the
        // database connections may still be open, so this is not a clean
        // stop however it was triggered.
        escalateExitCode(1);
      })
      .finally(() => {
        clearTimeout(timer);
        exit(pendingExitCode);
      });
  };

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
    beginShutdown(1, 'uncaughtException');
  });

  for (const signal of TERMINATION_SIGNALS) {
    process.on(signal, () => {
      if (shuttingDown) {
        // The operator asked twice (a second Ctrl+C). Stop waiting for
        // the in-flight teardown and terminate immediately.
        input.logger.fatal(
          { signal },
          'second termination signal received during shutdown; exiting immediately',
        );
        exit(1);
        return;
      }
      input.logger.info({ signal }, 'termination signal received; initiating graceful shutdown');
      beginShutdown(0, signal);
    });
  }
};

/** Test-only — reset module state between cases. */
export const __resetProcessHandlersForTests = (): void => {
  installed = false;
  unhandledRejectionCount = 0;
  transientNetworkErrorCount = 0;
  shuttingDown = false;
  pendingExitCode = 0;
  exited = false;
};

export const getUnhandledRejectionCount = (): number => unhandledRejectionCount;

/**
 * Count of `uncaughtException`s that were downgraded as transient
 * network blips (logged + tolerated rather than fatal). Surfaced for a
 * /health endpoint so operators can see connectivity churn.
 */
export const getTransientNetworkErrorCount = (): number => transientNetworkErrorCount;
