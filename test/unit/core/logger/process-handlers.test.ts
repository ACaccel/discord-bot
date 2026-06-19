/**
 * Process-handler installer tests.
 *
 * We verify the install-once contract and the counter side-effects.
 * Emitting a *fatal* `uncaughtException` would call `process.exit(1)`
 * and kill the test runner, so that path is left to the classifier's
 * own unit tests. The two paths that do NOT exit — `unhandledRejection`
 * and a *transient-network* `uncaughtException` — are exercised directly
 * because the handler returns without shutting down.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetProcessHandlersForTests,
  createLogger,
  getTransientNetworkErrorCount,
  getUnhandledRejectionCount,
  installProcessHandlers,
} from '../../../../src/core/logger';

const noopShutdown = async (): Promise<void> => undefined;

describe('installProcessHandlers', () => {
  afterEach(() => {
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
    __resetProcessHandlersForTests();
  });

  it('only attaches handlers once across repeated install calls (idempotent)', () => {
    const logger = createLogger({ level: 'silent', pretty: false });
    // Vitest installs its own listeners on these events; measure the
    // delta our installer contributes rather than the absolute count.
    const baselineRejection = process.listenerCount('unhandledRejection');
    const baselineException = process.listenerCount('uncaughtException');
    installProcessHandlers({ logger, gracefulShutdown: noopShutdown });
    const afterFirstRejection = process.listenerCount('unhandledRejection');
    const afterFirstException = process.listenerCount('uncaughtException');
    expect(afterFirstRejection - baselineRejection).toBe(1);
    expect(afterFirstException - baselineException).toBe(1);
    installProcessHandlers({ logger, gracefulShutdown: noopShutdown });
    expect(process.listenerCount('unhandledRejection')).toBe(afterFirstRejection);
    expect(process.listenerCount('uncaughtException')).toBe(afterFirstException);
  });

  it('emitting unhandledRejection bumps the counter without exiting', async () => {
    const logger = createLogger({ level: 'silent', pretty: false });
    const before = getUnhandledRejectionCount();
    installProcessHandlers({ logger, gracefulShutdown: noopShutdown });
    process.emit('unhandledRejection', new Error('test'), Promise.resolve());
    // Allow microtasks to flush.
    await new Promise<void>((r) => setImmediate(r));
    expect(getUnhandledRejectionCount()).toBe(before + 1);
  });

  it('downgrades a transient-network uncaughtException: counts it, never shuts down', async () => {
    const logger = createLogger({ level: 'silent', pretty: false });
    let shutdownCalls = 0;
    const before = getTransientNetworkErrorCount();
    installProcessHandlers({
      logger,
      gracefulShutdown: async () => {
        shutdownCalls += 1;
      },
    });
    // The exact crash signature: ECONNRESET / "socket hang up". The
    // handler returns before arming the shutdown timer, so emitting it
    // here is safe — the runner is not torn down.
    const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    process.emit('uncaughtException', err);
    await new Promise<void>((r) => setImmediate(r));
    expect(getTransientNetworkErrorCount()).toBe(before + 1);
    expect(shutdownCalls).toBe(0);
  });
});
