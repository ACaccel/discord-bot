/**
 * Unit tests for the startup cursor reconciliation.
 *
 * The contract under test: after a boot, the set of stored cursors in
 * every guild's database is exactly the configured `accounts` — a
 * removed account's cursor is deleted, a still-followed one survives —
 * and a database failure is logged and skipped, never thrown.
 */
import { describe, expect, it, vi } from 'vitest';

import { reconcileCursors, type FeedPassDeps } from '../../../../src/plugins/x-media-feed/internal';
import { parseXMediaFeedConfig } from '../../../../src/plugins/x-media-feed/config';
import type { XTimelineSource } from '../../../../src/infra/x-feed';
import type { GuildRegistry } from '../../../../src/core/guild-registry';
import type { Translator } from '../../../../src/core/i18n';
import type { Logger } from '../../../../src/core/logger';
import type { Repos } from '../../../../src/persistence/repositories';
import { createFakeClock } from '../../../../src/core/time';
import { ok, err } from '../../../../src/core/result';
import { DatabaseError } from '../../../../src/core/errors';

const dbError = (): DatabaseError =>
  new DatabaseError({
    code: 'DATABASE_UNKNOWN',
    messageKey: 'errors:db.unavailable',
    context: { operation: 'test' },
  });

/** In-memory cursor store exposing only what reconciliation touches. */
const makeRepos = (
  storedHandles: readonly string[],
  overrides: { listFails?: boolean; deleteFails?: boolean } = {},
): { repos: Repos; deleted: string[] } => {
  const handles = new Set(storedHandles);
  const deleted: string[] = [];
  const repos = {
    xFeedCursor: {
      listHandles: async () => (overrides.listFails === true ? err(dbError()) : ok([...handles])),
      deleteByHandle: async (handle: string) => {
        if (overrides.deleteFails === true) return err(dbError());
        deleted.push(handle);
        handles.delete(handle);
        return ok(true);
      },
    },
  } as unknown as Repos;
  return { repos, deleted };
};

const makeLogger = (): { logger: Logger; error: ReturnType<typeof vi.fn> } => {
  const error = vi.fn();
  const logger = {
    error,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  } as unknown as Logger;
  return { logger, error };
};

const makeDeps = (
  accounts: readonly { handle: string }[],
  guilds: readonly { guildId: string; repos?: Repos }[],
): { deps: FeedPassDeps; errorLog: ReturnType<typeof vi.fn> } => {
  const byId = new Map(guilds.map((g) => [g.guildId, g.repos]));
  const registry = {
    listGuildIds: () => guilds.map((g) => g.guildId),
    getRepos: (guildId: string) => byId.get(guildId),
    getChannel: () => undefined,
    getRole: () => undefined,
  } as unknown as GuildRegistry;

  const { logger, error } = makeLogger();
  return {
    deps: {
      source: { fetchTimeline: vi.fn() } as unknown as XTimelineSource,
      registry,
      translator: { t: (k: string) => k } as unknown as Translator,
      logger,
      clock: createFakeClock(0),
      config: parseXMediaFeedConfig({ enabled: true, accounts: [...accounts] }),
    },
    errorLog: error,
  };
};

describe('reconcileCursors', () => {
  it('deletes the cursor of an account removed from the configuration', async () => {
    const { repos, deleted } = makeRepos(['kept', 'removed']);
    const { deps } = makeDeps([{ handle: 'kept' }], [{ guildId: 'g1', repos }]);

    await reconcileCursors(deps);

    expect(deleted).toEqual(['removed']);
  });

  it('keeps every cursor when the configuration is unchanged', async () => {
    const { repos, deleted } = makeRepos(['a', 'b']);
    const { deps } = makeDeps([{ handle: 'a' }, { handle: 'b' }], [{ guildId: 'g1', repos }]);

    await reconcileCursors(deps);

    expect(deleted).toEqual([]);
  });

  it('treats a case-only handle change as remove-plus-add', async () => {
    // The cursor store is keyed by the exact configured string, so the
    // old casing's row must go — leaving it would orphan it forever,
    // because findByHandle would never match it again.
    const { repos, deleted } = makeRepos(['ACaccel']);
    const { deps } = makeDeps([{ handle: 'acaccel' }], [{ guildId: 'g1', repos }]);

    await reconcileCursors(deps);

    expect(deleted).toEqual(['ACaccel']);
  });

  it('sweeps every guild that has a database', async () => {
    const g1 = makeRepos(['kept', 'stale']);
    const g2 = makeRepos(['stale']);
    const { deps } = makeDeps(
      [{ handle: 'kept' }],
      [
        { guildId: 'g1', repos: g1.repos },
        { guildId: 'g2', repos: g2.repos },
      ],
    );

    await reconcileCursors(deps);

    expect(g1.deleted).toEqual(['stale']);
    expect(g2.deleted).toEqual(['stale']);
  });

  it('skips a guild without a database', async () => {
    const { deps } = makeDeps([{ handle: 'kept' }], [{ guildId: 'no-db' }]);
    await expect(reconcileCursors(deps)).resolves.toBeUndefined();
  });

  it('logs and skips a guild whose cursor listing fails, still sweeping the rest', async () => {
    const broken = makeRepos(['stale'], { listFails: true });
    const healthy = makeRepos(['stale']);
    const { deps, errorLog } = makeDeps(
      [{ handle: 'kept' }],
      [
        { guildId: 'broken', repos: broken.repos },
        { guildId: 'healthy', repos: healthy.repos },
      ],
    );

    await expect(reconcileCursors(deps)).resolves.toBeUndefined();

    expect(broken.deleted).toEqual([]);
    expect(healthy.deleted).toEqual(['stale']);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('logs a failed deletion and keeps sweeping', async () => {
    const { repos } = makeRepos(['stale-1', 'stale-2'], { deleteFails: true });
    const { deps, errorLog } = makeDeps([{ handle: 'kept' }], [{ guildId: 'g1', repos }]);

    await expect(reconcileCursors(deps)).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it('logs one info line per removed cursor for the operator', async () => {
    const { repos } = makeRepos(['stale-1', 'stale-2']);
    const { deps } = makeDeps([{ handle: 'kept' }], [{ guildId: 'g1', repos }]);

    await reconcileCursors(deps);

    const info = deps.logger.info as unknown as ReturnType<typeof vi.fn>;
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ plugin: 'x-media-feed', guildId: 'g1', handle: 'stale-1' }),
      expect.stringContaining('removed stale cursor'),
    );
  });
});
