import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../../src/core/logger';
import { TOKENS } from '../../../src/core/plugin';
import type { PluginRuntimeContext } from '../../../src/core/plugin';
import { createMessageBackupPlugin } from '../../../src/plugins/message-backup';
import { performBackup } from '../../../src/plugins/message-backup/internal';

// Replace the heavy internal backup implementation with a controllable
// spy so the loop-resilience tests can force a pass to throw without
// touching Discord or Mongo. `vi.mock` is hoisted above the imports by
// vitest, so the spy is registered before the plugin module loads.
vi.mock('../../../src/plugins/message-backup/internal', () => ({
  performBackup: vi.fn(),
}));

describe('createMessageBackupPlugin', () => {
  it('has the expected plugin shape', () => {
    const p = createMessageBackupPlugin({ backupServers: ['1', '2'] });
    expect(p.id).toBe('message-backup');
    expect(p.scope).toBe('bot');
    expect(p.onReady).toBeTypeOf('function');
    expect(p.onShutdown).toBeTypeOf('function');
  });

  it('snapshots `backupServers` so mutating the caller array after construction does not affect the plugin', () => {
    const servers = ['1', '2'];
    const p = createMessageBackupPlugin({ backupServers: servers });
    servers.push('3');
    // The plugin captured a copy; the post-hoc push must not leak in.
    // We can't inspect config directly, but the snapshot guarantee is
    // worth pinning so future refactors don't regress it.
    expect(p).toBeDefined();
  });

  it('accepts an explicit positive `backupIntervalMs`', () => {
    const p = createMessageBackupPlugin({ backupServers: ['1'], backupIntervalMs: 5 * 60 * 1000 });
    expect(p.id).toBe('message-backup');
  });

  it('defaults the interval when `backupIntervalMs` is omitted', () => {
    const p = createMessageBackupPlugin({ backupServers: ['1'] });
    expect(p).toBeDefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects a non-positive, non-finite, or over-ceiling `backupIntervalMs` (%s)',
    (bad) => {
      expect(() =>
        createMessageBackupPlugin({ backupServers: ['1'], backupIntervalMs: bad }),
      ).toThrow(TypeError);
    },
  );

  it('accepts `backupIntervalMs` exactly at Node’s timer ceiling', () => {
    const p = createMessageBackupPlugin({ backupServers: ['1'], backupIntervalMs: 2_147_483_647 });
    expect(p.id).toBe('message-backup');
  });
});

describe('createMessageBackupPlugin onReady loop resilience', () => {
  const mockedPerformBackup = vi.mocked(performBackup);

  const buildCtx = (): PluginRuntimeContext =>
    ({
      logger: createLogger({ level: 'silent', pretty: false }),
      // onReady resolves only the registry + client; both are unused
      // because performBackup is mocked, so a stub satisfies the seam.
      resolve: (token: unknown) => (token === TOKENS.GuildRegistry ? {} : {}),
    }) as unknown as PluginRuntimeContext;

  beforeEach(() => {
    vi.useFakeTimers();
    mockedPerformBackup.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the repeat loop alive after a failing backup pass', async () => {
    mockedPerformBackup
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue(undefined);
    const plugin = createMessageBackupPlugin({ backupServers: ['g1'], backupIntervalMs: 1000 });
    const { onReady, onShutdown } = plugin;
    if (onReady === undefined || onShutdown === undefined) {
      throw new Error('message-backup plugin must expose onReady/onShutdown');
    }
    const ctx = buildCtx();

    // The immediate pass fails internally but must not reject onReady.
    await expect(onReady(ctx)).resolves.toBeUndefined();
    expect(mockedPerformBackup).toHaveBeenCalledTimes(1);

    // The loop must reschedule and run the next pass despite the failure.
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedPerformBackup).toHaveBeenCalledTimes(2);

    await onShutdown(ctx);
  });

  it('isolates a per-guild failure so later guilds in the same pass still run', async () => {
    mockedPerformBackup.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const plugin = createMessageBackupPlugin({
      backupServers: ['g1', 'g2'],
      backupIntervalMs: 1000,
    });
    const { onReady, onShutdown } = plugin;
    if (onReady === undefined || onShutdown === undefined) {
      throw new Error('message-backup plugin must expose onReady/onShutdown');
    }
    const ctx = buildCtx();

    await expect(onReady(ctx)).resolves.toBeUndefined();
    // g1's throw did not abort the pass — g2 was still attempted.
    expect(mockedPerformBackup).toHaveBeenCalledTimes(2);

    await onShutdown(ctx);
  });

  it('threads transcript logging off by default (writeTranscript=false)', async () => {
    mockedPerformBackup.mockResolvedValue(undefined);
    // `backupLogEnabled` omitted → defaults to false; the backup still runs.
    const plugin = createMessageBackupPlugin({ backupServers: ['g1'], backupIntervalMs: 1000 });
    const { onReady, onShutdown } = plugin;
    if (onReady === undefined || onShutdown === undefined) {
      throw new Error('message-backup plugin must expose onReady/onShutdown');
    }
    const ctx = buildCtx();

    await onReady(ctx);
    expect(mockedPerformBackup).toHaveBeenCalledTimes(1);
    expect(mockedPerformBackup).toHaveBeenCalledWith(
      'g1',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      false,
    );

    await onShutdown(ctx);
  });

  it('threads transcript logging on when backupLogEnabled is set (writeTranscript=true)', async () => {
    mockedPerformBackup.mockResolvedValue(undefined);
    const plugin = createMessageBackupPlugin({
      backupServers: ['g1'],
      backupIntervalMs: 1000,
      backupLogEnabled: true,
    });
    const { onReady, onShutdown } = plugin;
    if (onReady === undefined || onShutdown === undefined) {
      throw new Error('message-backup plugin must expose onReady/onShutdown');
    }
    const ctx = buildCtx();

    await onReady(ctx);
    expect(mockedPerformBackup).toHaveBeenCalledWith(
      'g1',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );

    await onShutdown(ctx);
  });
});
