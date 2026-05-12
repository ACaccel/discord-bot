/**
 * Process-level safety net.
 *
 * `uncaughtException`: log + best-effort graceful shutdown with a
 * hard 5-second timeout, then `process.exit(1)`. Letting Node continue
 * past one is footgun territory — the process is in an indeterminate
 * state.
 *
 * `unhandledRejection`: log + counter increment. Do NOT exit; many
 * libraries fire-and-forget promises that reject benignly during
 * teardown. Phase 5+ will wire a rate-based admin notifier; for now
 * we surface the count via {@link getUnhandledRejectionCount} so a
 * /health endpoint can read it.
 *
 * Installation is idempotent at the module level via {@link installed}.
 * Multi-bot processes (one node process running >1 BaseBot) get a
 * single shared installation.
 */
import type { Logger } from './logger';

let installed = false;
let unhandledRejectionCount = 0;
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
  shuttingDown = false;
};

export const getUnhandledRejectionCount = (): number => unhandledRejectionCount;
