/**
 * Unit tests for the x-media-feed plugin shell: config validation at
 * composition time, and the self-rescheduling poll loop's resilience and
 * teardown. The pass itself is mocked out — `poll.test.ts` covers it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../../../src/core/logger';
import { TOKENS } from '../../../../src/bot/tokens';
import type { PluginRuntimeContext } from '../../../../src/core/plugin';
import { createXMediaFeedPlugin } from '../../../../src/plugins/x-media-feed';
import { reconcileCursors, runFeedPass } from '../../../../src/plugins/x-media-feed/internal';
import type { XTimelineSource } from '../../../../src/infra/x-feed';
import { ok } from '../../../../src/core/result';

// Replace the pass with a controllable spy so the loop tests can force a
// throw without touching the network, Mongo, or Discord. `vi.mock` is
// hoisted above the imports, so the spy is registered before the plugin
// module loads.
vi.mock('../../../../src/plugins/x-media-feed/internal', () => ({
  runFeedPass: vi.fn(),
  reconcileCursors: vi.fn(),
}));

const POLL_INTERVAL_MS = 60_000;
const stubSource = { fetchTimeline: async () => ok([]) } as unknown as XTimelineSource;

const enabledConfig = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  enabled: true,
  accounts: [{ handle: 'someaccount' }],
  pollIntervalMs: POLL_INTERVAL_MS,
  ...overrides,
});

describe('createXMediaFeedPlugin — shape and config', () => {
  it('accepts an absent config block and defaults to disabled', () => {
    expect(() => createXMediaFeedPlugin(undefined, { source: stubSource })).not.toThrow();
  });

  it('builds its own timeline source from config when none is injected', () => {
    // The production path: every other case supplies a fake source, so
    // without this the config-to-source plumbing is never executed.
    const plugin = createXMediaFeedPlugin(
      enabledConfig({ apiBaseUrl: 'https://self-hosted.invalid', timeoutMs: 1234 }),
    );
    expect(plugin.id).toBe('x-media-feed');
  });

  it('rejects an unknown key so a typo fails at boot', () => {
    expect(() =>
      createXMediaFeedPlugin(enabledConfig({ pollIntervalMS: 60_000 }), { source: stubSource }),
    ).toThrow();
  });

  it('rejects an enabled feed that follows nobody', () => {
    expect(() =>
      createXMediaFeedPlugin({ enabled: true, accounts: [] }, { source: stubSource }),
    ).toThrow();
  });

  it('rejects duplicate handles, which would share one cursor', () => {
    expect(() =>
      createXMediaFeedPlugin(enabledConfig({ accounts: [{ handle: 'dup' }, { handle: 'DUP' }] }), {
        source: stubSource,
      }),
    ).toThrow();
  });

  it.each(['bad handle', 'has-dash', 'toolonghandle1234', '@leading'])(
    'rejects the malformed handle %s',
    (handle) => {
      expect(() =>
        createXMediaFeedPlugin(enabledConfig({ accounts: [{ handle }] }), { source: stubSource }),
      ).toThrow();
    },
  );

  it.each([59_999, 0, -1, 2_147_483_648])(
    'rejects an out-of-range pollIntervalMs (%s)',
    (pollIntervalMs) => {
      expect(() =>
        createXMediaFeedPlugin(enabledConfig({ pollIntervalMs }), { source: stubSource }),
      ).toThrow();
    },
  );

  it('accepts pollIntervalMs exactly at Node’s timer ceiling', () => {
    expect(() =>
      createXMediaFeedPlugin(enabledConfig({ pollIntervalMs: 2_147_483_647 }), {
        source: stubSource,
      }),
    ).not.toThrow();
  });
});

describe('createXMediaFeedPlugin — poll loop', () => {
  const mockedRunFeedPass = vi.mocked(runFeedPass);
  const mockedReconcile = vi.mocked(reconcileCursors);

  const buildCtx = (): PluginRuntimeContext =>
    ({
      logger: createLogger({ level: 'silent', pretty: false }),
      translator: { t: (key: string) => key },
      // onReady resolves only the guild registry; the pass is mocked, so
      // an empty stub satisfies the seam.
      resolve: (token: unknown) => (token === TOKENS.GuildRegistry ? {} : {}),
    }) as unknown as PluginRuntimeContext;

  beforeEach(() => {
    vi.useFakeTimers();
    mockedRunFeedPass.mockReset();
    mockedRunFeedPass.mockResolvedValue(undefined);
    mockedReconcile.mockReset();
    mockedReconcile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const start = async (
    config: Record<string, unknown>,
  ): Promise<{ ctx: PluginRuntimeContext; shutdown: () => Promise<void> }> => {
    const plugin = createXMediaFeedPlugin(config, { source: stubSource });
    const { onReady, onShutdown } = plugin;
    if (onReady === undefined || onShutdown === undefined) {
      throw new Error('x-media-feed plugin must expose onReady/onShutdown');
    }
    const ctx = buildCtx();
    await onReady(ctx);
    return { ctx, shutdown: async () => onShutdown(ctx) };
  };

  it('reconciles stale cursors once, before the first pass', async () => {
    const { shutdown } = await start(enabledConfig());

    expect(mockedReconcile).toHaveBeenCalledTimes(1);
    const reconcileOrder = mockedReconcile.mock.invocationCallOrder[0];
    const firstPassOrder = mockedRunFeedPass.mock.invocationCallOrder[0];
    expect(reconcileOrder).toBeDefined();
    expect(firstPassOrder).toBeDefined();
    if (reconcileOrder !== undefined && firstPassOrder !== undefined) {
      expect(reconcileOrder).toBeLessThan(firstPassOrder);
    }

    // Once per boot only — later ticks must not re-run the sweep.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(mockedReconcile).toHaveBeenCalledTimes(1);

    await shutdown();
  });

  it('does not reconcile when disabled', async () => {
    const { shutdown } = await start({ enabled: false });
    expect(mockedReconcile).not.toHaveBeenCalled();
    await shutdown();
  });

  it('still polls when the reconciliation throws', async () => {
    mockedReconcile.mockRejectedValue(new Error('db exploded'));
    const { shutdown } = await start(enabledConfig());

    expect(mockedRunFeedPass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockedRunFeedPass).toHaveBeenCalledTimes(2);

    await shutdown();
  });

  it('does not poll at all when disabled', async () => {
    const { shutdown } = await start({ enabled: false });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    expect(mockedRunFeedPass).not.toHaveBeenCalled();
    await shutdown();
  });

  it('runs one pass immediately, then again on each interval', async () => {
    const { shutdown } = await start(enabledConfig());
    expect(mockedRunFeedPass).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockedRunFeedPass).toHaveBeenCalledTimes(2);

    await shutdown();
  });

  it('makes the first pass a full sweep, then uses the cursor path', async () => {
    const { shutdown } = await start(enabledConfig({ fullSweepEveryPolls: 3 }));
    expect(mockedRunFeedPass).toHaveBeenLastCalledWith(expect.anything(), true);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockedRunFeedPass).toHaveBeenLastCalledWith(expect.anything(), false);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockedRunFeedPass).toHaveBeenLastCalledWith(expect.anything(), false);

    // Every third pass re-reads the whole timeline.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockedRunFeedPass).toHaveBeenLastCalledWith(expect.anything(), true);

    await shutdown();
  });

  it('keeps the loop alive after a failing pass', async () => {
    mockedRunFeedPass
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue(undefined);
    const { shutdown } = await start(enabledConfig());

    // The immediate pass fails internally but must not reject onReady.
    expect(mockedRunFeedPass).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockedRunFeedPass).toHaveBeenCalledTimes(2);

    await shutdown();
  });

  it('does not reject onReady when the immediate pass throws', async () => {
    mockedRunFeedPass.mockRejectedValue(new Error('boom'));
    const plugin = createXMediaFeedPlugin(enabledConfig(), { source: stubSource });
    const { onReady, onShutdown } = plugin;
    if (onReady === undefined || onShutdown === undefined) throw new Error('missing hooks');
    const ctx = buildCtx();

    await expect(onReady(ctx)).resolves.toBeUndefined();
    await onShutdown(ctx);
  });

  it('stops polling after shutdown', async () => {
    const { shutdown } = await start(enabledConfig());
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockedRunFeedPass).toHaveBeenCalledTimes(2);

    await shutdown();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);

    expect(mockedRunFeedPass).toHaveBeenCalledTimes(2);
  });
});
