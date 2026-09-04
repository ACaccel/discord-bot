/**
 * Unit tests for one channel's backup walk.
 *
 * The invariant under test is cursor discipline. `backupChannel` picks
 * incremental or full mode from the persisted `Fetch` marker, drains
 * Discord a page at a time, and writes exactly one resume point at the
 * end — and the resume point must always be the newest message the
 * channel has seen, never the tail of a backward drain, or the next
 * pass would re-walk history it already holds.
 *
 * The second invariant is containment: a channel that fails must abort
 * itself and nothing else. The failure is recorded on `stats.error` for
 * the per-guild transcript, the cursor is left where it was so the next
 * pass retries the same ground, and the call still resolves so the
 * surrounding guild loop continues.
 */
import type { TextBasedChannel } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../../src/core/logger';
import { err, ok } from '../../../src/core/result';
import { databaseErrorFrom } from '../../../src/persistence/error-translator';
import type { Repos } from '../../../src/persistence/repositories';
import { backupChannel } from '../../../src/plugins/message-backup/internal/backup-channel';
import { BACKUP_RETRY_OPTIONS } from '../../../src/plugins/message-backup/internal/retry-policy';

const GUILD = 'g-1';
const PAGE_SIZE = 100;

const silent = createLogger({ level: 'silent', pretty: false });

const dbErr = () => err(databaseErrorFrom(new Error('boom'), { operation: 'test' }));

/** A discord.js `Message` reduced to what `saveBatch` reads. */
const message = (id: string, opts: { bot?: boolean } = {}): unknown => ({
  id,
  author: { bot: opts.bot ?? false, id: 'u-1', username: 'alice' },
  content: `content-${id}`,
  createdTimestamp: 1_700_000_000_000,
  attachments: new Map(),
  reactions: { cache: new Map() },
  stickers: new Map(),
});

/** A `MessageManager.fetch` result: the size the walker paginates on. */
type FetchResult = { size: number; values: () => Iterable<unknown> };

const fetchPage = (...ids: string[]): FetchResult => {
  const messages = ids.map((id) => message(id));
  return { size: messages.length, values: () => messages };
};

/** A page of `limit` synthetic messages, so the walker sees a full page. */
const fullPage = (startId: number): FetchResult =>
  fetchPage(...Array.from({ length: PAGE_SIZE }, (_, i) => String(startId + i)));

interface FetchOpts {
  readonly limit: number;
  readonly before?: string;
  readonly after?: string;
}

type FetchMock = ReturnType<typeof vi.fn<(opts: FetchOpts) => Promise<FetchResult>>>;

interface ChannelFake {
  readonly channel: TextBasedChannel;
  readonly fetch: FetchMock;
  /** The options object each `messages.fetch` call received, in order. */
  readonly calls: () => FetchOpts[];
}

const makeChannel = (
  pages: readonly (FetchResult | Error)[],
  input: { id?: string; name?: string } = {},
): ChannelFake => {
  const queue = [...pages];
  const fetch: FetchMock = vi.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next ?? fetchPage();
  });
  return {
    fetch,
    calls: () => fetch.mock.calls.map((c) => c[0]),
    channel: {
      id: input.id ?? 'chan-1',
      name: input.name ?? 'general',
      messages: { fetch },
    } as unknown as TextBasedChannel,
  };
};

interface ReposFake {
  readonly repos: Repos;
  readonly create: ReturnType<typeof vi.fn>;
  readonly upsert: ReturnType<typeof vi.fn>;
  readonly insertMany: ReturnType<typeof vi.fn>;
}

const makeRepos = (
  opts: {
    /** Persisted resume point; `undefined` means no `Fetch` doc yet. */
    lastMessageID?: string;
    findFetchFails?: boolean;
    createFails?: boolean;
    upsertFails?: boolean;
    /** Fails the bulk write from the nth batch onward (1-based). */
    insertFailsFromBatch?: number;
  } = {},
): ReposFake => {
  const create = vi.fn(async (channel: string, channelID: string, lastMessageID: string) =>
    opts.createFails === true ? dbErr() : ok({ channel, channelID, lastMessageID }),
  );
  const upsert = vi.fn(async () => (opts.upsertFails === true ? dbErr() : ok(undefined)));
  let batch = 0;
  const insertMany = vi.fn(async (docs: readonly unknown[]) => {
    batch += 1;
    if (opts.insertFailsFromBatch !== undefined && batch >= opts.insertFailsFromBatch) {
      return dbErr();
    }
    return ok({ inserted: docs.length, duplicates: 0 });
  });
  const repos = {
    fetch: {
      findByChannelId: vi.fn(async () =>
        opts.findFetchFails === true
          ? dbErr()
          : ok(
              opts.lastMessageID === undefined ? undefined : { lastMessageID: opts.lastMessageID },
            ),
      ),
      create,
      upsertLastMessageID: upsert,
    },
    message: {
      findExistingMessageIds: vi.fn(async () => ok(new Set<string>())),
      insertManyIgnoringDuplicates: insertMany,
    },
  } as unknown as Repos;
  return { repos, create, upsert, insertMany };
};

const noProgress = async (): Promise<void> => undefined;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('backupChannel — full mode', () => {
  it('creates the missing progress marker before walking the channel', async () => {
    const { repos, create } = makeRepos();
    const { channel } = makeChannel([fetchPage('100')]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(create).toHaveBeenCalledWith('general', 'chan-1', '');
    expect(stats.mode).toBe('full');
    expect(stats.resumeFromMsgId).toBeUndefined();
  });

  it('drains backward from the head, stepping `before` to each page’s oldest id', async () => {
    const { repos } = makeRepos();
    const { channel, calls } = makeChannel([fullPage(1000), fetchPage('900', '901')]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(calls()).toEqual([{ limit: 100 }, { limit: 100, before: '1000' }]);
    expect(stats.batches).toBe(2);
    expect(stats.totalFetched).toBe(102);
  });

  it('records the head message as the resume point, not the tail of the drain', async () => {
    // A backward drain ends on the channel's oldest message; persisting
    // that would make the next incremental pass re-fetch everything.
    const { repos, upsert } = makeRepos();
    const { channel } = makeChannel([fullPage(1000), fetchPage('900')]);

    await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith('general', 'chan-1', '1099');
  });

  it('stops on the first empty page and writes no resume point', async () => {
    const { repos, upsert } = makeRepos();
    const { channel, fetch } = makeChannel([fetchPage()]);

    const { stats, added } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stats.batches).toBe(0);
    expect(added).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('accumulates the archive bounds across every page it walked', async () => {
    const { repos } = makeRepos();
    const { channel } = makeChannel([fullPage(1000), fetchPage('900', '950')]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(stats.startMsgId).toBe('900');
    expect(stats.endMsgId).toBe('1099');
    expect(stats.startMsgContent).toBe('content-900');
    expect(stats.endMsgContent).toBe('content-1099');
  });
});

describe('backupChannel — incremental mode', () => {
  it('resumes after the persisted marker and advances the cursor page by page', async () => {
    const { repos, create, upsert } = makeRepos({ lastMessageID: '500' });
    const { channel, calls } = makeChannel([fullPage(1000), fetchPage('1100')]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(create).not.toHaveBeenCalled();
    expect(stats.mode).toBe('incremental');
    expect(stats.resumeFromMsgId).toBe('500');
    expect(calls()).toEqual([
      { limit: 100, after: '500' },
      { limit: 100, after: '1099' },
    ]);
    // Forward drain: the last page's newest message becomes the marker.
    expect(upsert).toHaveBeenCalledWith('general', 'chan-1', '1100');
  });

  it('treats an empty marker as a first-ever backup and walks in full mode', async () => {
    const { repos } = makeRepos({ lastMessageID: '' });
    const { channel, calls } = makeChannel([fetchPage('100')]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(stats.mode).toBe('full');
    expect(calls()).toEqual([{ limit: 100 }]);
  });

  it('leaves the marker untouched when the channel has nothing new', async () => {
    const { repos, upsert } = makeRepos({ lastMessageID: '500' });
    const { channel } = makeChannel([fetchPage()]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(upsert).not.toHaveBeenCalled();
    expect(stats.batches).toBe(0);
  });
});

describe('backupChannel — progress reporting', () => {
  it('reports progress only for pages that actually stored something', async () => {
    const onProgress = vi.fn(async () => undefined);
    const { repos } = makeRepos();
    const botPage = {
      size: PAGE_SIZE,
      values: () =>
        Array.from({ length: PAGE_SIZE }, (_, i) => message(String(2000 + i), { bot: true })),
    };
    const { channel } = makeChannel([botPage, fetchPage('1000')]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, onProgress);

    expect(stats.skippedBots).toBe(PAGE_SIZE);
    expect(stats.newMessages).toBe(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('rolls the per-page tallies up into the channel statistics', async () => {
    const { repos } = makeRepos();
    const { channel } = makeChannel([fetchPage('100', '101')]);

    const { stats, added } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(added).toBe(2);
    expect(stats).toMatchObject({
      channelId: 'chan-1',
      channelName: 'general',
      batches: 1,
      totalFetched: 2,
      newMessages: 2,
      skippedBots: 0,
      skippedDuplicates: 0,
    });
    expect(stats.error).toBeUndefined();
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back to an empty channel name when Discord exposes none', async () => {
    const { repos, create } = makeRepos();
    const fetch = vi.fn(async () => fetchPage('100'));
    const channel = { id: 'chan-2', messages: { fetch } } as unknown as TextBasedChannel;

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(stats.channelName).toBe('');
    expect(create).toHaveBeenCalledWith('', 'chan-2', '');
  });
});

describe('backupChannel — failure containment', () => {
  it('records a failed marker lookup and never touches Discord', async () => {
    const { repos } = makeRepos({ findFetchFails: true });
    const { channel, fetch } = makeChannel([fetchPage('100')]);

    const { stats, added } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(stats.error).toBeDefined();
    expect(added).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records a failed marker creation and never touches Discord', async () => {
    const { repos } = makeRepos({ createFails: true });
    const { channel, fetch } = makeChannel([fetchPage('100')]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(stats.error).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves rather than throwing when Discord rejects the fetch', async () => {
    // The guild loop calls this per channel; a throw here would abandon
    // every channel queued behind this one.
    const { repos, upsert } = makeRepos();
    const { channel } = makeChannel([new Error('Missing Access')]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(stats.error).toContain('Missing Access');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps the pages it already stored when a later page fails to write', async () => {
    const { repos, upsert } = makeRepos({ insertFailsFromBatch: 2 });
    const { channel } = makeChannel([fullPage(1000), fetchPage('900')]);

    const { stats, added } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(added).toBe(PAGE_SIZE);
    expect(stats.error).toBeDefined();
    // The marker is not advanced, so the next pass re-walks this ground.
    expect(upsert).not.toHaveBeenCalled();
  });

  it('records a failed marker write as a channel error', async () => {
    const { repos, upsert } = makeRepos({ upsertFails: true });
    const { channel } = makeChannel([fetchPage('100')]);

    const { stats } = await backupChannel(channel, repos, GUILD, silent, noProgress);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(stats.error).toBeDefined();
    // Bounds are only published on a clean run; a failed write leaves them unset.
    expect(stats.endMsgId).toBeUndefined();
  });

  it('retries a transient Discord failure and completes the walk', async () => {
    vi.useFakeTimers();
    const { repos, upsert } = makeRepos();
    const transient = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const { channel, fetch } = makeChannel([transient, fetchPage('100')]);

    const pending = backupChannel(channel, repos, GUILD, silent, noProgress);
    // The first backoff is jittered up to 1.5x the policy's initial
    // delay; run past the widest wait.
    await vi.advanceTimersByTimeAsync(BACKUP_RETRY_OPTIONS.initialDelayMs! * 2);
    const { stats } = await pending;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(stats.error).toBeUndefined();
    expect(upsert).toHaveBeenCalledWith('general', 'chan-1', '100');
  });

  it('rides out a multi-minute outage before recording the channel as failed', async () => {
    // A lost route surfaces as a bare Node socket error. The walker must
    // keep trying for the policy's full budget — an unattended pass can
    // afford to wait — and only then record the failure and move on.
    vi.useFakeTimers();
    const { repos, upsert } = makeRepos();
    const unreachable = () =>
      Object.assign(new Error('read EHOSTUNREACH'), { code: 'EHOSTUNREACH' });
    const { channel, fetch } = makeChannel(
      Array.from({ length: BACKUP_RETRY_OPTIONS.maxAttempts! }, unreachable),
    );

    const pending = backupChannel(channel, repos, GUILD, silent, noProgress);
    // Sum of the jittered backoffs at their widest: initial * 1.5 * (2^n - 1).
    const widestTotal =
      BACKUP_RETRY_OPTIONS.initialDelayMs! *
      1.5 *
      (2 ** (BACKUP_RETRY_OPTIONS.maxAttempts! - 1) - 1);
    await vi.advanceTimersByTimeAsync(widestTotal);
    const { stats } = await pending;

    expect(fetch).toHaveBeenCalledTimes(BACKUP_RETRY_OPTIONS.maxAttempts!);
    expect(stats.error).toContain('EHOSTUNREACH');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('recovers when the route comes back partway through the budget', async () => {
    vi.useFakeTimers();
    const { repos, upsert } = makeRepos();
    const unreachable = () =>
      Object.assign(new Error('read EHOSTUNREACH'), { code: 'EHOSTUNREACH' });
    const { channel, fetch } = makeChannel([unreachable(), unreachable(), fetchPage('100')]);

    const pending = backupChannel(channel, repos, GUILD, silent, noProgress);
    // Two jittered waits at their widest: initial * 1.5 * (1 + 2).
    await vi.advanceTimersByTimeAsync(BACKUP_RETRY_OPTIONS.initialDelayMs! * 1.5 * 3);
    const { stats } = await pending;

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(stats.error).toBeUndefined();
    expect(upsert).toHaveBeenCalledWith('general', 'chan-1', '100');
  });
});
