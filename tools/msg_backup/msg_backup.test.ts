/**
 * Unit suite for the `msg_backup` ops tool. Targets the pure helpers
 * exported from `./internal.ts`; the per-guild orchestrator and the
 * run-log lifecycle in `msg_backup.ts` are exercised only via manual
 * ops runs against a real Discord + Mongo cluster.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DiscordAPIError } from 'discord.js';
import type { Message } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigurationError } from '../../src/core/errors/configuration-error';

import {
  type AnomalyChannelStats,
  type ArchivedThreadFetcher,
  type ArchivedThreadType,
  type BackfillChannelLike,
  type ChannelOutcomeLike,
  type ThreadManagerLike,
  activeThreadFetcher,
  archivedThreadFetcher,
  buildAnomalies,
  buildBackfillDoc,
  enumerateChannelThreads,
  isTransientError,
  parseConfig,
  withRetry,
} from './internal';
import { maskMongoUri } from './text-logger';

// ---------- parseConfig ----------

describe('msg_backup / parseConfig', () => {
  let tmpDir: string;
  const writeConfig = (body: unknown): string => {
    const p = join(tmpDir, 'config.json');
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    return p;
  };
  const minimal = {
    mongo_uri: 'mongodb://h:27017/',
    discord_token: 't',
    guilds: ['123'],
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'msg-backup-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a minimal config and defaults batch_size=500, deleteBotMessages=true', () => {
    const cfg = parseConfig(writeConfig(minimal));
    expect(cfg).toEqual({
      mongoUri: 'mongodb://h:27017/',
      discordToken: 't',
      startDate: undefined,
      guilds: ['123'],
      deleteBotMessages: true,
      batchSize: 500,
    });
  });

  it('normalises mongo_uri by stripping query string and re-asserting a single trailing slash', () => {
    expect(parseConfig(writeConfig({ ...minimal, mongo_uri: 'mongodb://h/' })).mongoUri).toBe(
      'mongodb://h/',
    );
    expect(parseConfig(writeConfig({ ...minimal, mongo_uri: 'mongodb://h' })).mongoUri).toBe(
      'mongodb://h/',
    );
    expect(
      parseConfig(writeConfig({ ...minimal, mongo_uri: 'mongodb://h/?authSource=admin' })).mongoUri,
    ).toBe('mongodb://h/');
    expect(parseConfig(writeConfig({ ...minimal, mongo_uri: 'mongodb://h///' })).mongoUri).toBe(
      'mongodb://h/',
    );
  });

  it('rejects an empty guilds array', () => {
    expect(() => parseConfig(writeConfig({ ...minimal, guilds: [] }))).toThrow(ConfigurationError);
  });

  it('rejects non-digit guild ids', () => {
    expect(() => parseConfig(writeConfig({ ...minimal, guilds: ['abc'] }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects missing mongo_uri / discord_token', () => {
    expect(() => parseConfig(writeConfig({ discord_token: 't', guilds: ['1'] }))).toThrow(
      ConfigurationError,
    );
    expect(() => parseConfig(writeConfig({ mongo_uri: 'mongodb://h/', guilds: ['1'] }))).toThrow(
      ConfigurationError,
    );
  });

  it('accepts an explicit start_date and rejects an invalid one', () => {
    expect(parseConfig(writeConfig({ ...minimal, start_date: '2024-01-01' })).startDate).toBe(
      '2024-01-01',
    );
    expect(parseConfig(writeConfig({ ...minimal, start_date: '' })).startDate).toBeUndefined();
    expect(() => parseConfig(writeConfig({ ...minimal, start_date: '2024-13-01' }))).toThrow(
      ConfigurationError,
    );
    expect(() => parseConfig(writeConfig({ ...minimal, start_date: 'not-a-date' }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects non-positive / non-integer batch_size', () => {
    expect(() => parseConfig(writeConfig({ ...minimal, batch_size: 0 }))).toThrow(
      ConfigurationError,
    );
    expect(() => parseConfig(writeConfig({ ...minimal, batch_size: -1 }))).toThrow(
      ConfigurationError,
    );
    expect(() => parseConfig(writeConfig({ ...minimal, batch_size: 1.5 }))).toThrow(
      ConfigurationError,
    );
  });

  it('honours an explicit batch_size and delete_bot_messages override', () => {
    const cfg = parseConfig(
      writeConfig({ ...minimal, batch_size: 100, delete_bot_messages: false }),
    );
    expect(cfg.batchSize).toBe(100);
    expect(cfg.deleteBotMessages).toBe(false);
  });

  it('rejects a non-boolean delete_bot_messages', () => {
    expect(() => parseConfig(writeConfig({ ...minimal, delete_bot_messages: 'yes' }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects malformed JSON and non-object root', () => {
    expect(() => parseConfig(writeConfig('garbage'))).toThrow(ConfigurationError);
    expect(() => parseConfig(writeConfig('[]'))).toThrow(ConfigurationError);
  });
});

// ---------- buildBackfillDoc ----------

interface FakeAttachment {
  id: string;
  name: string | null;
  url: string;
  contentType: string | null;
}
interface FakeReaction {
  emoji: { id: string | null; name: string | null; animated: boolean | null };
  count: number;
  users: { cache: { map: <T>(fn: (u: { id: string }) => T) => T[] } };
}
interface FakeSticker {
  id: string;
  name: string | null;
}

const cacheLike = <T>(items: readonly T[]): { values: () => IterableIterator<T> } => ({
  values: () => items[Symbol.iterator]() as IterableIterator<T>,
});

const fakeMessage = (overrides: {
  attachments?: readonly FakeAttachment[];
  reactions?: readonly FakeReaction[];
  stickers?: readonly FakeSticker[];
}): Message => {
  const attachments = overrides.attachments ?? [];
  const reactions = overrides.reactions ?? [];
  const stickers = overrides.stickers ?? [];
  return {
    id: 'msg-1',
    content: 'hello',
    createdTimestamp: 1_700_000_000_000,
    author: { id: 'u-1', username: 'alice', bot: false },
    attachments: cacheLike(attachments),
    reactions: { cache: cacheLike(reactions) },
    stickers: cacheLike(stickers),
  } as unknown as Message;
};

const FAKE_CHANNEL: BackfillChannelLike = { id: 'c-1', name: 'general' };

describe('msg_backup / buildBackfillDoc', () => {
  it('emits all top-level scalars and empty arrays when nothing is attached', () => {
    const { doc, skipped } = buildBackfillDoc(fakeMessage({}), FAKE_CHANNEL);
    expect(doc).toEqual({
      channelId: 'c-1',
      channelName: 'general',
      content: 'hello',
      messageId: 'msg-1',
      userId: 'u-1',
      userName: 'alice',
      timestamp: 1_700_000_000_000,
      attachments: [],
      reactions: [],
      stickers: [],
    });
    expect(skipped).toEqual({ attachments: false, reactions: false, stickers: false });
  });

  it('omits attachments and flags skipped=true when one attachment has name=null', () => {
    const { doc, skipped } = buildBackfillDoc(
      fakeMessage({
        attachments: [{ id: 'a1', name: null, url: 'http://x', contentType: 'image/png' }],
      }),
      FAKE_CHANNEL,
    );
    expect('attachments' in doc).toBe(false);
    expect(skipped.attachments).toBe(true);
    // The other arrays remain populated.
    expect(doc).toMatchObject({ reactions: [], stickers: [] });
  });

  it('omits the entire attachments array when only the SECOND element is bad', () => {
    const { doc, skipped } = buildBackfillDoc(
      fakeMessage({
        attachments: [
          { id: 'a1', name: 'good.png', url: 'http://x/1', contentType: 'image/png' },
          { id: 'a2', name: null, url: 'http://x/2', contentType: null },
        ],
      }),
      FAKE_CHANNEL,
    );
    expect('attachments' in doc).toBe(false);
    expect(skipped.attachments).toBe(true);
  });

  it('omits reactions when one reaction.emoji.name is null', () => {
    const { doc, skipped } = buildBackfillDoc(
      fakeMessage({
        reactions: [
          {
            emoji: { id: '1', name: null, animated: false },
            count: 1,
            users: { cache: { map: () => [] } },
          },
        ],
      }),
      FAKE_CHANNEL,
    );
    expect('reactions' in doc).toBe(false);
    expect(skipped.reactions).toBe(true);
  });

  it('omits stickers when one sticker.name is null', () => {
    const { doc, skipped } = buildBackfillDoc(
      fakeMessage({ stickers: [{ id: 's1', name: null }] }),
      FAKE_CHANNEL,
    );
    expect('stickers' in doc).toBe(false);
    expect(skipped.stickers).toBe(true);
  });

  it('round-trips a well-formed attachment with contentType=null falling back to undefined', () => {
    const { doc } = buildBackfillDoc(
      fakeMessage({
        attachments: [{ id: 'a1', name: 'pic.png', url: 'http://x', contentType: null }],
      }),
      FAKE_CHANNEL,
    );
    expect(doc['attachments']).toEqual([
      { id: 'a1', name: 'pic.png', url: 'http://x', contentType: undefined },
    ]);
  });
});

// ---------- isTransientError ----------

const makeDiscordError = (status: number, code: number): DiscordAPIError =>
  new DiscordAPIError(
    { code, message: 'x' },
    code,
    status,
    'GET',
    'https://discord.example/api',
    {},
  );

describe('msg_backup / isTransientError', () => {
  it.each([10003, 10004, 10008, 50001, 50013, 50021, 50035])(
    'classifies DiscordAPIError code %i as non-transient',
    (code) => {
      // Status is intentionally a normally-transient one to prove the
      // non-transient blacklist short-circuits before the HTTP check.
      expect(isTransientError(makeDiscordError(500, code))).toBe(false);
    },
  );

  it.each([429, 500, 502, 503, 504])(
    'classifies DiscordAPIError HTTP status %i as transient',
    (status) => {
      // Use code 0 (definitely not on the non-transient blacklist).
      expect(isTransientError(makeDiscordError(status, 0))).toBe(true);
    },
  );

  it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'])(
    'classifies node-level code "%s" as transient',
    (code) => {
      expect(isTransientError({ code })).toBe(true);
    },
  );

  it('does not retry plain Errors (regex fallback removed)', () => {
    expect(isTransientError(new Error('timeout while doing thing'))).toBe(false);
    expect(isTransientError(new Error('connection reset'))).toBe(false);
  });

  it('returns false for null / primitives / unknown shapes', () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError('string')).toBe(false);
    expect(isTransientError({ random: 'shape' })).toBe(false);
  });
});

// ---------- withRetry ----------

describe('msg_backup / withRetry', () => {
  const noopSleep = async (): Promise<void> => undefined;

  it('returns on first success without invoking onRetry', async () => {
    const fn = vi.fn(async () => 'ok');
    const onRetry = vi.fn();
    expect(await withRetry(fn, 'ctx', onRetry, noopSleep)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries once on a transient failure, then succeeds', async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw makeDiscordError(503, 0);
      return 'ok';
    });
    const onRetry = vi.fn();
    expect(await withRetry(fn, 'ctx', onRetry, noopSleep)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting three retries on persistent transient errors', async () => {
    const err = makeDiscordError(503, 0);
    const fn = vi.fn(async () => {
      throw err;
    });
    const onRetry = vi.fn();
    await expect(withRetry(fn, 'ctx', onRetry, noopSleep)).rejects.toBe(err);
    // Initial attempt + 3 retries = 4 calls.
    expect(fn).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('does not retry on a non-transient error', async () => {
    const err = makeDiscordError(403, 50013);
    const fn = vi.fn(async () => {
      throw err;
    });
    const onRetry = vi.fn();
    await expect(withRetry(fn, 'ctx', onRetry, noopSleep)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

// ---------- buildAnomalies ----------

const emptyStats: AnomalyChannelStats = {
  upserted: 0,
  deletedBot: 0,
  skippedNullAuthor: 0,
  skippedAttachments: 0,
  skippedReactions: 0,
  skippedStickers: 0,
  processed: 0,
};

interface OkOverrides {
  readonly channelId?: string;
  readonly channelName?: string;
  readonly status?: ChannelOutcomeLike['status'];
  readonly reason?: string;
  readonly stats?: Partial<AnomalyChannelStats>;
}

const ok = (partial: OkOverrides): ChannelOutcomeLike => ({
  channelId: partial.channelId ?? 'c1',
  channelName: partial.channelName ?? '#chan',
  status: partial.status ?? 'ok',
  ...(partial.reason !== undefined ? { reason: partial.reason } : {}),
  stats: { ...emptyStats, ...(partial.stats ?? {}) },
});

describe('msg_backup / buildAnomalies', () => {
  it('does not emit anything for a plain ok channel with no field-skip', () => {
    expect(buildAnomalies([ok({})])).toEqual([]);
  });

  it('emits field-skip-ok when an ok channel tripped any field-skip', () => {
    const out = buildAnomalies([ok({ stats: { skippedAttachments: 3 } })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('field-skip-ok');
    expect(out[0]?.reason).toMatch(/3 attachments/);
    expect(out[0]?.note).toBe('ok, DB values preserved on the noted fields');
  });

  it('prefers retried-but-ok over field-skip-ok on the same channel', () => {
    const out = buildAnomalies([
      ok({
        status: 'retried-but-ok',
        reason: '1 retry, eventually succeeded',
        stats: { skippedReactions: 1 },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('retried-but-ok');
    expect(out[0]?.note).toBe('ok, just transient');
  });

  it('emits partialUpserted on aborted channels that managed some progress', () => {
    const out = buildAnomalies([ok({ status: 'aborted', reason: 'boom', stats: { upserted: 7 } })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'aborted', partialUpserted: 7 });
  });

  it('does not emit partialUpserted when aborted made zero progress', () => {
    const out = buildAnomalies([
      ok({ status: 'aborted', reason: 'no progress', stats: { upserted: 0 } }),
    ]);
    expect(out[0]?.partialUpserted).toBeUndefined();
  });

  it('falls back to a default reason when the outcome carries none', () => {
    const out = buildAnomalies([ok({ status: 'no-permission' })]);
    expect(out[0]?.reason).toBe('(no reason recorded)');
  });
});

// ---------- maskMongoUri (text-logger spot check) ----------

describe('msg_backup / maskMongoUri', () => {
  it('replaces the password segment with ****', () => {
    expect(maskMongoUri('mongodb://user:secret@h:27017/')).toBe('mongodb://user:****@h:27017/');
  });

  it('leaves credential-less URIs untouched', () => {
    expect(maskMongoUri('mongodb://h:27017/')).toBe('mongodb://h:27017/');
  });

  it('handles mongodb+srv URIs', () => {
    expect(maskMongoUri('mongodb+srv://user:hunter2@cluster.example/')).toBe(
      'mongodb+srv://user:****@cluster.example/',
    );
  });
});

// ---------- thread enumeration ----------

interface FakeThread {
  readonly id: string;
  readonly archiveTimestamp?: number | null;
}
const t = (id: string, archiveTimestamp?: number): FakeThread => ({
  id,
  ...(archiveTimestamp !== undefined ? { archiveTimestamp } : {}),
});
const noBatch = (): void => {};
/** Single-page archived fetcher (`hasMore: false`). */
const onePage =
  (byType: { public: FakeThread[]; private: FakeThread[] }) =>
  (type: ArchivedThreadType): ArchivedThreadFetcher<FakeThread> =>
  () =>
    Promise.resolve({ threads: byType[type], hasMore: false });

describe('msg_backup / enumerateChannelThreads', () => {
  it('runs active + both archived passes and includes archived private threads', async () => {
    const result = await enumerateChannelThreads<FakeThread>(
      () => Promise.resolve({ threads: [t('active-1')] }),
      onePage({ public: [t('pub-1', 100)], private: [t('priv-1', 50)] }),
      noBatch,
    );

    // Regression: the archived-private pass must run, or archived private
    // threads are silently dropped (default fetchArchived is public-only).
    expect(result.active.map((x) => x.id)).toEqual(['active-1']);
    expect(result.archived.map((x) => x.id)).toEqual(['pub-1', 'priv-1']);
    expect(result.privateArchivedFailure).toBeUndefined();
    expect(result.truncatedPasses).toEqual([]);
  });

  it('fetches active threads in a single call (no pagination cursor)', async () => {
    let activeCalls = 0;
    await enumerateChannelThreads<FakeThread>(
      () => {
        activeCalls += 1;
        // 50 active threads (== a full archived page) must NOT trigger a
        // second fetch; fetchActive has no cursor and returns all at once.
        return Promise.resolve({
          threads: Array.from({ length: 50 }, (_, i) => t(`a${String(i)}`)),
        });
      },
      onePage({ public: [], private: [] }),
      noBatch,
    );
    expect(activeCalls).toBe(1);
  });

  it('paginates archived threads by hasMore, advancing the archive-timestamp cursor', async () => {
    const pubPages: { threads: FakeThread[]; hasMore: boolean }[] = [
      { threads: [t('p1', 300), t('p2', 200)], hasMore: true },
      { threads: [t('p3', 100)], hasMore: false },
    ];
    const cursors: (number | undefined)[] = [];
    let call = 0;
    const result = await enumerateChannelThreads<FakeThread>(
      () => Promise.resolve({ threads: [] }),
      (type) => (cursor) => {
        if (type === 'private') return Promise.resolve({ threads: [], hasMore: false });
        cursors.push(cursor.before);
        const page = pubPages[call++];
        if (page === undefined) throw new Error('unexpected extra archived fetch');
        return Promise.resolve(page);
      },
      noBatch,
    );

    expect(result.archived.map((x) => x.id)).toEqual(['p1', 'p2', 'p3']);
    // First call has no cursor; the second is bounded by the oldest
    // timestamp of page one (200), not a `pageSize < limit` guess.
    expect(cursors).toEqual([undefined, 200]);
    expect(result.truncatedPasses).toEqual([]);
  });

  it('stops and flags truncation when hasMore stays true but the cursor cannot advance', async () => {
    let calls = 0;
    const result = await enumerateChannelThreads<FakeThread>(
      () => Promise.resolve({ threads: [] }),
      (type) => () => {
        if (type === 'private') return Promise.resolve({ threads: [], hasMore: false });
        calls += 1;
        // Same already-seen thread every page, with hasMore forever true:
        // a `pageSize < limit` loop would hang here. We must stop.
        return Promise.resolve({ threads: [t('dup', 100)], hasMore: true });
      },
      noBatch,
    );

    expect(calls).toBe(2); // page 1 collects 'dup'; page 2 is all-seen -> stop
    expect(result.archived.map((x) => x.id)).toEqual(['dup']);
    expect(result.truncatedPasses).toEqual(['archived-public']);
  });

  it('isolates a private-pass failure while keeping active + public threads', async () => {
    const result = await enumerateChannelThreads<FakeThread>(
      () => Promise.resolve({ threads: [t('active-1')] }),
      (type) => () =>
        type === 'private'
          ? Promise.reject(new Error('Missing Permissions'))
          : Promise.resolve({ threads: [t('pub-1', 100)], hasMore: false }),
      noBatch,
    );

    // The private failure is surfaced (not swallowed) but does not discard
    // the threads already collected from the other two passes.
    expect(result.active.map((x) => x.id)).toEqual(['active-1']);
    expect(result.archived.map((x) => x.id)).toEqual(['pub-1']);
    expect(result.privateArchivedFailure).toBe('Missing Permissions');
    expect(result.truncatedPasses).toEqual([]);
  });

  it('lets an active or archived-public pass failure propagate to the caller', async () => {
    await expect(
      enumerateChannelThreads<FakeThread>(
        () => Promise.reject(new Error('active boom')),
        onePage({ public: [], private: [] }),
        noBatch,
      ),
    ).rejects.toThrow('active boom');

    await expect(
      enumerateChannelThreads<FakeThread>(
        () => Promise.resolve({ threads: [] }),
        (type) => () =>
          type === 'public'
            ? Promise.reject(new Error('public boom'))
            : Promise.resolve({ threads: [], hasMore: false }),
        noBatch,
      ),
    ).rejects.toThrow('public boom');
  });
});

// ---------- discord.js ThreadManager adapters ----------

interface ArchivedCall {
  readonly type: ArchivedThreadType;
  readonly fetchAll?: boolean;
  readonly before?: number;
  readonly limit?: number;
}

const fakeManager = (
  calls: ArchivedCall[],
  active: FakeThread[] = [],
): ThreadManagerLike<FakeThread> => ({
  fetchActive: () => Promise.resolve({ threads: cacheLike(active) }),
  fetchArchived: (options) => {
    calls.push(options);
    return Promise.resolve({ threads: cacheLike([]), hasMore: false });
  },
});

describe('msg_backup / thread manager adapters', () => {
  it('activeThreadFetcher reads from a single fetchActive call', async () => {
    let activeCalls = 0;
    const manager: ThreadManagerLike<FakeThread> = {
      fetchActive: () => {
        activeCalls += 1;
        return Promise.resolve({ threads: cacheLike([t('a1'), t('a2')]) });
      },
      fetchArchived: () => Promise.resolve({ threads: cacheLike([]), hasMore: false }),
    };
    const page = await activeThreadFetcher(manager)();
    expect([...page.threads].map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(activeCalls).toBe(1);
  });

  it('archivedThreadFetcher sets fetchAll only for the private pass', async () => {
    const calls: ArchivedCall[] = [];
    const fetchArchived = archivedThreadFetcher(fakeManager(calls));

    await fetchArchived('public')({ before: 200, limit: 50 });
    await fetchArchived('private')({ before: 200, limit: 50 });

    // Regression: the public pass must NOT pass fetchAll; the private
    // pass MUST, or discord.js routes to the joined-archived endpoint
    // (snowflake cursor) and ignores the timestamp `before`, so the
    // pagination cursor can never advance.
    expect(calls[0]).toEqual({ type: 'public', before: 200, limit: 50 });
    expect(calls[1]).toEqual({ type: 'private', fetchAll: true, before: 200, limit: 50 });
  });

  it('archivedThreadFetcher omits before on the first (cursorless) page', async () => {
    const calls: ArchivedCall[] = [];
    const fetchArchived = archivedThreadFetcher(fakeManager(calls));
    await fetchArchived('private')({ limit: 50 });
    expect(calls[0]).toEqual({ type: 'private', fetchAll: true, limit: 50 });
    expect('before' in (calls[0] ?? {})).toBe(false);
  });
});
