/**
 * Process-handler installer tests.
 *
 * We only verify the install-once contract and the side-effects on the
 * exposed counter — actually invoking `uncaughtException` would call
 * `process.exit(1)`, which would terminate the test runner. The
 * counter increment for `unhandledRejection` can be exercised because
 * the handler does not exit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetProcessHandlersForTests,
  createLogger,
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
});
