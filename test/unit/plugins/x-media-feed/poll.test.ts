/**
 * Unit tests for one x-media-feed pass.
 *
 * The invariant under test is cursor discipline: the cursor advances
 * only past posts that actually reached Discord, so a failed send is
 * retried rather than skipped, and a first pass never backfills nor
 * swallows a genuinely new post. The other half is failure isolation —
 * a pass must survive a bad guild, account, repository read, or send,
 * and must say so in the log rather than going quiet.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Channel } from 'discord.js';

import {
  runFeedPass,
  snowflakeFloorAt,
  type FeedPassDeps,
} from '../../../../src/plugins/x-media-feed/internal';
import { parseXMediaFeedConfig } from '../../../../src/plugins/x-media-feed/config';
import type { XPost, XTimelineSource } from '../../../../src/infra/x-feed';
import type { GuildRegistry } from '../../../../src/bot/guild-registry';
import type { Translator } from '../../../../src/core/i18n';
import type { Logger } from '../../../../src/core/logger';
import type { Repos } from '../../../../src/persistence/repositories';
import { createFakeClock } from '../../../../src/core/time';
import { ok, err } from '../../../../src/core/result';
import { DatabaseError, XFeedError } from '../../../../src/core/errors';

const HANDLE = 'someaccount';
const GUILD = 'guild-1';
const NOW_MS = 1_787_800_000_000;

const fakeTranslator = {
  t: (key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params ?? {})}`,
} as unknown as Translator;

/**
 * Logger whose children are itself, so `logError`'s `.child()` call is
 * observable. Child bindings are recorded rather than discarded, so a
 * regression that dropped or mis-passed the `guildId` scope is visible
 * and not just the call count.
 */
const makeLogger = (): {
  logger: Logger;
  error: ReturnType<typeof vi.fn>;
  bindings: Record<string, unknown>[];
} => {
  const error = vi.fn();
  const bindings: Record<string, unknown>[] = [];
  const logger = {
    error,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: (b: Record<string, unknown>) => {
      bindings.push(b);
      return logger;
    },
  } as unknown as Logger;
  return { logger, error, bindings };
};

/** An id a post created at `atMs` would plausibly carry. */
const snowflakeFuture = (atMs: number): string => (BigInt(snowflakeFloorAt(atMs)) + 1n).toString();

const post = (overrides: Partial<XPost> & Pick<XPost, 'id'>): XPost => ({
  authorHandle: HANDLE,
  createdTimestamp: Number(overrides.id) * 10,
  url: `https://x.com/${HANDLE}/status/${overrides.id}`,
  isReply: false,
  isRepost: false,
  media: [{ kind: 'photo', url: 'https://pbs.twimg.com/media/a.jpg' }],
  ...overrides,
});

interface CursorRow {
  readonly handle: string;
  readonly last_seen_id: string;
  readonly last_seen_timestamp: number;
}

/** In-memory cursor repo plus the spies each case asserts on. */
const makeRepos = (
  initial?: CursorRow,
  overrides: { findFails?: boolean; upsertFails?: boolean } = {},
): { repos: Repos; upsert: ReturnType<typeof vi.fn>; read: () => CursorRow | undefined } => {
  let row = initial;
  const upsert = vi.fn(async (handle: string, id: string, timestamp: number) => {
    if (overrides.upsertFails === true) {
      return err(
        new DatabaseError({
          code: 'DATABASE_UNKNOWN',
          messageKey: 'errors:db.unavailable',
          context: { operation: 'test' },
        }),
      );
    }
    row = { handle, last_seen_id: id, last_seen_timestamp: timestamp };
    return ok(undefined);
  });
  const repos = {
    xFeedCursor: {
      findByHandle: async () =>
        overrides.findFails === true
          ? err(
              new DatabaseError({
                code: 'DATABASE_TIMEOUT',
                messageKey: 'errors:db.timeout',
                context: { operation: 'test' },
              }),
            )
          : ok(row),
      upsert,
    },
  } as unknown as Repos;
  return { repos, upsert, read: () => row };
};

/** Payload shape `sendFeedPost` hands to `channel.send`. */
interface SendPayload {
  readonly content: string;
  readonly allowedMentions: unknown;
}
type SendSpy = ReturnType<typeof vi.fn<(payload: SendPayload) => Promise<undefined>>>;

const makeSend = (): SendSpy => vi.fn(async () => undefined);

const makeChannel = (send: SendSpy, sendable = true): Channel =>
  ({ isSendable: () => sendable, send }) as unknown as Channel;

interface HarnessInput {
  readonly posts?: readonly XPost[];
  readonly fetchError?: boolean;
  readonly repos?: Repos;
  readonly channel?: Channel;
  /** Full control over channel resolution, keyed by (guildId, name). */
  readonly resolveChannel?: (guildId: string, name: string) => Channel | undefined;
  readonly guildIds?: readonly string[];
  readonly accounts?: readonly { handle: string; channel?: string }[];
  readonly maxPostsPerPoll?: number;
}

const harness = (
  input: HarnessInput = {},
): {
  deps: FeedPassDeps;
  fetchTimeline: ReturnType<typeof vi.fn>;
  getChannel: ReturnType<typeof vi.fn>;
  errorLog: ReturnType<typeof vi.fn>;
  logBindings: Record<string, unknown>[];
} => {
  const fetchTimeline = vi.fn(async () =>
    input.fetchError === true
      ? err(
          new XFeedError({
            code: 'X_FEED_NOT_FOUND',
            messageKey: 'errors:x_feed.not_found',
            context: { operation: 'test' },
          }),
        )
      : ok(input.posts ?? []),
  );
  const source = { fetchTimeline } as unknown as XTimelineSource;

  const getChannel = vi.fn((guildId: string, name: string) =>
    input.resolveChannel === undefined ? input.channel : input.resolveChannel(guildId, name),
  );
  const registry = {
    listGuildIds: () => input.guildIds ?? [GUILD],
    getRepos: () => input.repos,
    getChannel,
    getRole: () => undefined,
  } as unknown as GuildRegistry;

  const config = parseXMediaFeedConfig({
    enabled: true,
    accounts: input.accounts ?? [{ handle: HANDLE }],
    maxPostsPerPoll: input.maxPostsPerPoll ?? 5,
  });

  const { logger, error, bindings } = makeLogger();
  return {
    deps: {
      source,
      registry,
      translator: fakeTranslator,
      logger,
      clock: createFakeClock(NOW_MS),
      config,
    },
    fetchTimeline,
    getChannel,
    errorLog: error,
    logBindings: bindings,
  };
};

describe('runFeedPass — first pass', () => {
  it('seeds the cursor and posts nothing', async () => {
    const send = makeSend();
    const { repos, read } = makeRepos();
    const { deps } = harness({
      posts: [post({ id: '10' }), post({ id: '30' })],
      repos,
      channel: makeChannel(send),
    });

    await runFeedPass(deps, false);

    expect(send).not.toHaveBeenCalled();
    expect(read()).toEqual({ handle: HANDLE, last_seen_id: '30', last_seen_timestamp: 300 });
  });

  it('seeds from a repost-only page instead of leaving the cursor unset', async () => {
    // Regression: leaving no cursor here meant the NEXT pass consumed the
    // account's first genuinely new post as its baseline and never sent it.
    const { repos, read } = makeRepos();
    const { deps } = harness({
      posts: [post({ id: '99', isRepost: true, authorHandle: 'other' })],
      repos,
      channel: makeChannel(makeSend()),
    });

    await runFeedPass(deps, false);

    expect(read()?.last_seen_id).toBe('99');
  });

  it('forwards the first new post after a repost-only first pass', async () => {
    const send = makeSend();
    const { repos, read } = makeRepos();
    const repost = post({ id: '99', isRepost: true, authorHandle: 'other' });
    const channel = makeChannel(send);

    // Pass 1: nothing but reposts.
    const first = harness({ posts: [repost], repos, channel });
    await runFeedPass(first.deps, false);
    expect(send).not.toHaveBeenCalled();

    // Pass 2: the account publishes an original media post.
    const fresh = post({ id: '100' });
    const second = harness({ posts: [repost, fresh], repos, channel });
    await runFeedPass(second.deps, false);

    expect(send).toHaveBeenCalledTimes(1);
    expect(read()?.last_seen_id).toBe('100');
  });

  it('seeds an empty timeline from a clock-derived id floor, not from zero', async () => {
    // A '0' baseline is below every post ever published, so the next full
    // sweep — which drops `since` and returns the whole page — would drain
    // the account's back catalogue into the channel.
    const { repos, read } = makeRepos();
    const { deps } = harness({ posts: [], repos, channel: makeChannel(makeSend()) });

    await runFeedPass(deps, false);

    const row = read();
    expect(row?.last_seen_timestamp).toBe(Math.floor(NOW_MS / 1000));
    expect(row?.last_seen_id).toBe(snowflakeFloorAt(NOW_MS));
    expect(BigInt(row?.last_seen_id ?? '0')).toBeGreaterThan(0n);
  });

  it('does not backfill pre-existing posts after an empty first page', async () => {
    const send = makeSend();
    const { repos } = makeRepos();
    const channel = makeChannel(send);
    // Published well before the poller ever looked at this account.
    const backlog = [
      post({ id: '2092744659667673582', createdTimestamp: 1_787_784_182 }),
      post({ id: '2092744659667673583', createdTimestamp: 1_787_784_183 }),
    ];

    await runFeedPass(harness({ posts: [], repos, channel }).deps, false);
    // A full sweep drops `since`, so the whole page comes back.
    await runFeedPass(harness({ posts: backlog, repos, channel }).deps, true);

    expect(send).not.toHaveBeenCalled();
  });

  it('still forwards a post published after an empty first page', async () => {
    const send = makeSend();
    const { repos } = makeRepos();
    const channel = makeChannel(send);

    await runFeedPass(harness({ posts: [], repos, channel }).deps, false);

    // Created a minute after the baseline was taken.
    const fresh = post({ id: snowflakeFuture(NOW_MS + 60_000), createdTimestamp: 1 });
    await runFeedPass(harness({ posts: [fresh], repos, channel }).deps, false);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('requests the timeline without `since` when no cursor exists', async () => {
    const { repos } = makeRepos();
    const { deps, fetchTimeline } = harness({
      posts: [post({ id: '10' })],
      repos,
      channel: makeChannel(makeSend()),
    });

    await runFeedPass(deps, false);

    expect(fetchTimeline).toHaveBeenCalledWith(HANDLE, { sinceTimestamp: undefined });
  });
});

describe('runFeedPass — forwarding', () => {
  it('forwards new posts oldest-first and advances the cursor to the last one', async () => {
    const send = makeSend();
    const { repos, read } = makeRepos({
      handle: HANDLE,
      last_seen_id: '10',
      last_seen_timestamp: 100,
    });
    const { deps } = harness({
      posts: [post({ id: '30' }), post({ id: '20' })],
      repos,
      channel: makeChannel(send),
    });

    await runFeedPass(deps, false);

    expect(send).toHaveBeenCalledTimes(2);
    const sentUrls = send.mock.calls.map((c) => c[0].content);
    expect(sentUrls[0]).toContain('/status/20');
    expect(sentUrls[1]).toContain('/status/30');
    expect(read()?.last_seen_id).toBe('30');
  });

  it('rewrites the link onto the embed-proxy host and suppresses mentions', async () => {
    const send = makeSend();
    const { repos } = makeRepos({ handle: HANDLE, last_seen_id: '10', last_seen_timestamp: 100 });
    const { deps } = harness({ posts: [post({ id: '20' })], repos, channel: makeChannel(send) });

    await runFeedPass(deps, false);

    const payload = send.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    if (payload === undefined) return;
    expect(payload.content).toContain('https://fxtwitter.com/');
    expect(payload.content).not.toContain('https://x.com/');
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  it('sends nothing and leaves the cursor alone when there is nothing new', async () => {
    const send = makeSend();
    const { repos, upsert } = makeRepos({
      handle: HANDLE,
      last_seen_id: '30',
      last_seen_timestamp: 300,
    });
    const { deps } = harness({
      posts: [post({ id: '30' }), post({ id: '20' })],
      repos,
      channel: makeChannel(send),
    });

    await runFeedPass(deps, false);

    expect(send).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('honours the per-pass cap, leaving the remainder for the next pass', async () => {
    const send = makeSend();
    const { repos, read } = makeRepos({
      handle: HANDLE,
      last_seen_id: '5',
      last_seen_timestamp: 50,
    });
    const { deps } = harness({
      posts: [post({ id: '10' }), post({ id: '20' }), post({ id: '30' })],
      repos,
      channel: makeChannel(send),
      maxPostsPerPoll: 2,
    });

    await runFeedPass(deps, false);

    expect(send).toHaveBeenCalledTimes(2);
    // The cursor stops at the last delivered post, so 30 is still pending.
    expect(read()?.last_seen_id).toBe('20');
  });
});

describe('runFeedPass — channel routing', () => {
  it('looks the channel up under the polled guild id and the default name', async () => {
    const { repos } = makeRepos();
    const { deps, getChannel } = harness({
      guildIds: ['g-alpha'],
      repos,
      channel: makeChannel(makeSend()),
    });

    await runFeedPass(deps, false);

    expect(getChannel).toHaveBeenCalledWith('g-alpha', 'x_feed');
  });

  it('routes an account with its own `channel` to that channel, not the default', async () => {
    const defaultSend = makeSend();
    const overrideSend = makeSend();
    const { repos } = makeRepos({ handle: 'artist', last_seen_id: '5', last_seen_timestamp: 50 });
    const { deps } = harness({
      posts: [post({ id: '10', authorHandle: 'artist' })],
      repos,
      accounts: [{ handle: 'artist', channel: 'art_feed' }],
      resolveChannel: (_guildId, name) =>
        name === 'art_feed' ? makeChannel(overrideSend) : makeChannel(defaultSend),
    });

    await runFeedPass(deps, false);

    expect(overrideSend).toHaveBeenCalledTimes(1);
    expect(defaultSend).not.toHaveBeenCalled();
  });

  it('resolves the channel before fetching, so an opted-out guild costs no request', async () => {
    // Deferring this check until after the fetch made upstream traffic
    // scale with total guild count and wrote cursors for guilds that had
    // deliberately not configured the feed.
    const { repos, upsert } = makeRepos();
    const { deps, fetchTimeline } = harness({
      guildIds: ['g1', 'g2'],
      repos,
      resolveChannel: () => undefined,
    });

    await runFeedPass(deps, false);

    expect(fetchTimeline).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('polls only the guilds that configured the feed', async () => {
    const send = makeSend();
    const { repos } = makeRepos();
    const { deps, fetchTimeline } = harness({
      guildIds: ['g1', 'g2', 'g3'],
      repos,
      resolveChannel: (guildId) => (guildId === 'g2' ? makeChannel(send) : undefined),
    });

    await runFeedPass(deps, false);

    expect(fetchTimeline).toHaveBeenCalledTimes(1);
  });

  it('skips a channel that resolves but is not sendable', async () => {
    const send = makeSend();
    const { repos, upsert } = makeRepos();
    const { deps, fetchTimeline } = harness({ repos, channel: makeChannel(send, false) });

    await runFeedPass(deps, false);

    expect(fetchTimeline).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('runFeedPass — cursor and sweep semantics', () => {
  it('passes the stored timestamp as `since` on a normal pass', async () => {
    const { repos } = makeRepos({ handle: HANDLE, last_seen_id: '10', last_seen_timestamp: 100 });
    const { deps, fetchTimeline } = harness({ repos, channel: makeChannel(makeSend()) });

    await runFeedPass(deps, false);

    expect(fetchTimeline).toHaveBeenCalledWith(HANDLE, { sinceTimestamp: 100 });
  });

  it('drops `since` on a full sweep so a same-second post cannot hide', async () => {
    const { repos } = makeRepos({ handle: HANDLE, last_seen_id: '10', last_seen_timestamp: 100 });
    const { deps, fetchTimeline } = harness({ repos, channel: makeChannel(makeSend()) });

    await runFeedPass(deps, true);

    expect(fetchTimeline).toHaveBeenCalledWith(HANDLE, { sinceTimestamp: undefined });
  });
});

describe('runFeedPass — failure isolation', () => {
  it('advances the cursor to the last delivered post when a later send fails', async () => {
    const send = vi
      .fn<(payload: SendPayload) => Promise<undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('Missing Permissions'));
    const { repos, read } = makeRepos({
      handle: HANDLE,
      last_seen_id: '5',
      last_seen_timestamp: 50,
    });
    const { deps } = harness({
      posts: [post({ id: '10' }), post({ id: '20' })],
      repos,
      channel: makeChannel(send),
    });

    await expect(runFeedPass(deps, false)).resolves.toBeUndefined();

    // 10 went out, 20 did not — the cursor must not step over 20.
    expect(read()?.last_seen_id).toBe('10');
  });

  it('logs a send failure rather than going silently quiet', async () => {
    // Without this, swallowing the error inside forwardPosts would be
    // indistinguishable from the propagate-and-log design, and an
    // operator would see a feed that had simply stopped.
    const send = vi.fn(async () => {
      throw new Error('Missing Permissions');
    });
    const { repos } = makeRepos({ handle: HANDLE, last_seen_id: '5', last_seen_timestamp: 50 });
    const { deps, errorLog } = harness({
      posts: [post({ id: '10' })],
      repos,
      channel: makeChannel(send),
    });

    await runFeedPass(deps, false);

    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('scopes the failure log to the guild it happened in', async () => {
    const send = vi.fn(async () => {
      throw new Error('Missing Permissions');
    });
    const { repos } = makeRepos({ handle: HANDLE, last_seen_id: '5', last_seen_timestamp: 50 });
    const { deps, logBindings } = harness({
      guildIds: ['g-scoped'],
      posts: [post({ id: '10' })],
      repos,
      channel: makeChannel(send),
    });

    await runFeedPass(deps, false);

    expect(logBindings).toContainEqual({ guildId: 'g-scoped' });
  });

  it('leaves the cursor untouched when the very first send fails', async () => {
    const send = vi.fn(async () => {
      throw new Error('Missing Permissions');
    });
    const { repos, upsert } = makeRepos({
      handle: HANDLE,
      last_seen_id: '5',
      last_seen_timestamp: 50,
    });
    const { deps } = harness({ posts: [post({ id: '10' })], repos, channel: makeChannel(send) });

    await expect(runFeedPass(deps, false)).resolves.toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps polling later accounts after one account throws', async () => {
    const send = vi
      .fn<(payload: SendPayload) => Promise<undefined>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const { repos } = makeRepos({ handle: HANDLE, last_seen_id: '5', last_seen_timestamp: 50 });
    const { deps, fetchTimeline } = harness({
      posts: [post({ id: '10' })],
      repos,
      channel: makeChannel(send),
      accounts: [{ handle: 'first' }, { handle: 'second' }],
    });

    await expect(runFeedPass(deps, false)).resolves.toBeUndefined();
    expect(fetchTimeline).toHaveBeenCalledTimes(2);
  });

  it('skips a guild that has no database', async () => {
    const { deps, fetchTimeline } = harness({ repos: undefined });
    await runFeedPass(deps, false);
    expect(fetchTimeline).not.toHaveBeenCalled();
  });

  it('skips an account whose cursor read fails, and logs it', async () => {
    const { repos } = makeRepos(undefined, { findFails: true });
    const { deps, fetchTimeline, errorLog } = harness({ repos, channel: makeChannel(makeSend()) });

    await expect(runFeedPass(deps, false)).resolves.toBeUndefined();
    expect(fetchTimeline).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('skips an account whose timeline read fails, leaving the cursor alone and logging it', async () => {
    const { repos, upsert } = makeRepos({
      handle: HANDLE,
      last_seen_id: '5',
      last_seen_timestamp: 50,
    });
    const { deps, errorLog } = harness({
      fetchError: true,
      repos,
      channel: makeChannel(makeSend()),
    });

    await expect(runFeedPass(deps, false)).resolves.toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('survives a cursor write failure after a successful send', async () => {
    const send = makeSend();
    const { repos } = makeRepos(
      { handle: HANDLE, last_seen_id: '5', last_seen_timestamp: 50 },
      { upsertFails: true },
    );
    const { deps, errorLog } = harness({
      posts: [post({ id: '10' })],
      repos,
      channel: makeChannel(send),
    });

    await expect(runFeedPass(deps, false)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
