/**
 * Unit tests for the message-backup channel walk.
 *
 * `collectChannels` answers two separate questions with one pass, and
 * the tests keep them apart. `channels` is what the backup loop will
 * walk — only text-like surfaces that can actually serve messages.
 * `liveChannelIds` is what the stale-marker sweep treats as still
 * existing, and it is deliberately the wider set: a surface that holds
 * no messages of its own still exists, and forgetting it would let the
 * sweep delete a healthy progress marker.
 *
 * The other invariant is partial coverage over none. Thread
 * enumeration is several paginated calls per parent channel; any of
 * them can fail, and a failure must cost only that call's threads.
 */
import { ChannelType, type Guild } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../../src/core/logger';
import { collectChannels } from '../../../src/plugins/message-backup/internal/collect-channels';

const GUILD = 'g-1';

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

interface ThreadSpec {
  readonly id: string;
  readonly type?: ChannelType;
  readonly archivedAt?: Date | null;
}

const thread = (spec: ThreadSpec): unknown => ({
  id: spec.id,
  name: `thread-${spec.id}`,
  type: spec.type ?? ChannelType.PublicThread,
  archivedAt: spec.archivedAt ?? null,
  messages: { fetch: vi.fn() },
});

/** One `fetchArchived` response page. */
interface ArchivedPage {
  readonly threads: readonly ThreadSpec[];
  readonly hasMore?: boolean;
}

interface ChannelSpec {
  readonly id: string;
  readonly name?: string;
  readonly type?: ChannelType;
  /** When false the channel exposes no `messages` manager (a forum root). */
  readonly sendsMessages?: boolean;
  /**
   * When every thread field is omitted the channel exposes no thread
   * manager at all. A `null` entry models an empty slot in the page.
   */
  readonly activeThreads?: readonly (ThreadSpec | null)[];
  readonly activeThreadsError?: Error;
  readonly archivedPages?: Readonly<Record<'public' | 'private', readonly ArchivedPage[]>>;
  readonly archivedError?: Readonly<Partial<Record<'public' | 'private', Error>>>;
}

interface FetchArchivedCall {
  readonly type: 'public' | 'private';
  readonly limit: number;
  readonly fetchAll: boolean;
  readonly before?: Date;
}

const buildChannel = (
  spec: ChannelSpec,
): { channel: unknown; fetchArchived: ReturnType<typeof vi.fn> } => {
  const queues: Record<'public' | 'private', ArchivedPage[]> = {
    public: [...(spec.archivedPages?.public ?? [])],
    private: [...(spec.archivedPages?.private ?? [])],
  };
  const fetchArchived = vi.fn(async (opts: FetchArchivedCall) => {
    const failure = spec.archivedError?.[opts.type];
    if (failure !== undefined) throw failure;
    const next = queues[opts.type].shift() ?? { threads: [] };
    return {
      threads: new Map(next.threads.map((t) => [t.id, thread(t)])),
      hasMore: next.hasMore ?? false,
    };
  });
  const hasThreads =
    spec.activeThreads !== undefined ||
    spec.activeThreadsError !== undefined ||
    spec.archivedPages !== undefined ||
    spec.archivedError !== undefined;
  const channel: Record<string, unknown> = {
    id: spec.id,
    name: spec.name ?? `chan-${spec.id}`,
    type: spec.type ?? ChannelType.GuildText,
  };
  if (spec.sendsMessages !== false) channel.messages = { fetch: vi.fn() };
  if (hasThreads) {
    channel.threads = {
      fetchActive: vi.fn(async () => {
        if (spec.activeThreadsError !== undefined) throw spec.activeThreadsError;
        return {
          threads: new Map(
            (spec.activeThreads ?? []).map((t, i) => [
              t?.id ?? `hole-${String(i)}`,
              t && thread(t),
            ]),
          ),
        };
      }),
      fetchArchived,
    };
  }
  return { channel, fetchArchived };
};

const makeGuild = (
  specs: readonly ChannelSpec[],
): {
  guild: Guild;
  channelsFetch: ReturnType<typeof vi.fn>;
  fetchArchivedOf: (id: string) => ReturnType<typeof vi.fn>;
} => {
  const built = specs.map(buildChannel);
  const channelsFetch = vi.fn(async () => undefined);
  return {
    channelsFetch,
    fetchArchivedOf: (id: string) => {
      const index = specs.findIndex((s) => s.id === id);
      const entry = built[index];
      if (entry === undefined) throw new Error(`no channel fake for ${id}`);
      return entry.fetchArchived;
    },
    guild: {
      id: GUILD,
      channels: {
        fetch: channelsFetch,
        cache: new Map(built.map((b, i) => [specs[i]?.id ?? String(i), b.channel])),
      },
    } as unknown as Guild,
  };
};

const idsOf = (channels: readonly unknown[]): string[] =>
  channels.map((c) => (c as { id: string }).id);

afterEach(() => {
  vi.clearAllMocks();
});

describe('collectChannels — what the walk returns', () => {
  it('refreshes the channel cache before reading it', async () => {
    // The cache is only as complete as the last fetch; walking a stale
    // one would silently skip channels created since startup.
    const { guild, channelsFetch } = makeGuild([{ id: 'c1' }]);
    const { logger } = makeLogger();

    await collectChannels(guild, logger);

    expect(channelsFetch).toHaveBeenCalledTimes(1);
  });

  it('collects the text-like channel types and rejects the rest', async () => {
    const { guild } = makeGuild([
      { id: 'text', type: ChannelType.GuildText },
      { id: 'voice', type: ChannelType.GuildVoice },
      { id: 'announce', type: ChannelType.GuildAnnouncement },
      { id: 'stage', type: ChannelType.GuildStageVoice },
      { id: 'category', type: ChannelType.GuildCategory },
      { id: 'dm', type: ChannelType.DM },
    ]);
    const { logger } = makeLogger();

    const { channels, liveChannelIds } = await collectChannels(guild, logger);

    expect(idsOf(channels)).toEqual(['text', 'voice', 'announce', 'stage']);
    expect(liveChannelIds.has('category')).toBe(false);
    expect(liveChannelIds.has('dm')).toBe(false);
  });

  it('marks a message-less forum root as live without queueing it for backup', async () => {
    // A forum root carries no messages of its own, so it cannot be
    // walked — but it exists, and dropping it from `liveChannelIds`
    // would make the sweep delete its progress marker.
    const { guild } = makeGuild([
      { id: 'forum', type: ChannelType.GuildForum, sendsMessages: false },
    ]);
    const { logger } = makeLogger();

    const { channels, liveChannelIds } = await collectChannels(guild, logger);

    expect(idsOf(channels)).toEqual([]);
    expect(liveChannelIds.has('forum')).toBe(true);
  });

  it('skips a channel that exposes no thread manager without failing the walk', async () => {
    const { guild } = makeGuild([{ id: 'c1' }, { id: 'c2' }]);
    const { logger, error } = makeLogger();

    const { channels } = await collectChannels(guild, logger);

    expect(idsOf(channels)).toEqual(['c1', 'c2']);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('collectChannels — thread enumeration', () => {
  it('adds active threads alongside their parent channel', async () => {
    const { guild } = makeGuild([{ id: 'c1', activeThreads: [{ id: 't1' }, { id: 't2' }] }]);
    const { logger } = makeLogger();

    const { channels, liveChannelIds } = await collectChannels(guild, logger);

    expect(idsOf(channels)).toEqual(['c1', 't1', 't2']);
    expect(liveChannelIds.has('t1')).toBe(true);
  });

  it('steps over an empty slot in a thread page and keeps the rest', async () => {
    const { guild } = makeGuild([{ id: 'c1', activeThreads: [null, { id: 't1' }] }]);
    const { logger, error } = makeLogger();

    const { channels } = await collectChannels(guild, logger);

    expect(idsOf(channels)).toEqual(['c1', 't1']);
    expect(error).not.toHaveBeenCalled();
  });

  it('drains archived threads page by page, stepping `before` to the oldest archive time', async () => {
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-02-01T00:00:00Z');
    const { guild, fetchArchivedOf } = makeGuild([
      {
        id: 'c1',
        archivedPages: {
          public: [
            {
              threads: [
                { id: 't-newer', archivedAt: newer },
                { id: 't-older', archivedAt: older },
              ],
              hasMore: true,
            },
            { threads: [{ id: 't-last', archivedAt: null }] },
          ],
          private: [],
        },
      },
    ]);
    const { logger } = makeLogger();

    const { channels } = await collectChannels(guild, logger);

    const publicCalls = fetchArchivedOf('c1')
      .mock.calls.map((c) => c[0] as FetchArchivedCall)
      .filter((c) => c.type === 'public');
    expect(publicCalls).toHaveLength(2);
    expect(publicCalls[0]?.before).toBeUndefined();
    expect(publicCalls[1]?.before).toBe(older);
    expect(idsOf(channels)).toEqual(['c1', 't-newer', 't-older', 't-last']);
  });

  it('walks both visibility classes, requesting the full set only for private threads', async () => {
    const { guild, fetchArchivedOf } = makeGuild([
      { id: 'c1', archivedPages: { public: [], private: [] } },
    ]);
    const { logger } = makeLogger();

    await collectChannels(guild, logger);

    expect(fetchArchivedOf('c1').mock.calls.map((c) => c[0])).toEqual([
      { type: 'public', limit: 100, fetchAll: false },
      { type: 'private', limit: 100, fetchAll: true },
    ]);
  });

  it('lists a thread once even when it surfaces as both active and archived', async () => {
    const { guild } = makeGuild([
      {
        id: 'c1',
        activeThreads: [{ id: 't1' }],
        archivedPages: { public: [{ threads: [{ id: 't1' }] }], private: [] },
      },
    ]);
    const { logger } = makeLogger();

    const { channels } = await collectChannels(guild, logger);

    expect(idsOf(channels)).toEqual(['c1', 't1']);
  });
});

describe('collectChannels — failure isolation', () => {
  it('keeps the parent channel and later channels when active threads fail to load', async () => {
    const { guild } = makeGuild([
      { id: 'c1', activeThreadsError: new Error('Missing Access') },
      { id: 'c2', activeThreads: [{ id: 't2' }] },
    ]);
    const { logger, error } = makeLogger();

    const { channels } = await collectChannels(guild, logger);

    expect(idsOf(channels)).toEqual(['c1', 'c2', 't2']);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('still walks private threads after the public archive fetch fails', async () => {
    const { guild } = makeGuild([
      {
        id: 'c1',
        archivedPages: { public: [], private: [{ threads: [{ id: 't-private' }] }] },
        archivedError: { public: new Error('Missing Access') },
      },
    ]);
    const { logger, error } = makeLogger();

    const { channels } = await collectChannels(guild, logger);

    expect(idsOf(channels)).toEqual(['c1', 't-private']);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('abandons only the failing page of an archive drain, keeping what it already read', async () => {
    const { guild } = makeGuild([
      {
        id: 'c1',
        activeThreads: [{ id: 't-active' }],
        archivedError: { public: new Error('boom'), private: new Error('boom') },
      },
    ]);
    const { logger, error } = makeLogger();

    const { channels, liveChannelIds } = await collectChannels(guild, logger);

    expect(idsOf(channels)).toEqual(['c1', 't-active']);
    expect(liveChannelIds).toEqual(new Set(['c1', 't-active']));
    // One log per failing visibility class — the failure is never silent.
    expect(error).toHaveBeenCalledTimes(2);
  });
});
