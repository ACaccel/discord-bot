/**
 * Unit tests for one guild's backup pass.
 *
 * `performBackup` is the msg-archive personality's entire job, so the
 * invariants pinned here are operational ones: the pass refuses to
 * start when a precondition is missing rather than half-running, it
 * reports progress and a final tally into the debug channel, and it
 * sweeps `Fetch` markers only for channels Discord confirms are gone —
 * never for one that merely failed to load.
 *
 * The transcript is the other observable. It is asserted through a
 * recording stand-in for the log sink so the assertions describe what
 * an operator would read, without a run writing into `logs/backup/`.
 */
import { ChannelType, DiscordAPIError } from 'discord.js';
import type { Client } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuildRegistry } from '../../../src/bot/guild-registry';
import { err, ok } from '../../../src/core/result';
import type { Logger } from '../../../src/core/logger';
import { databaseErrorFrom } from '../../../src/persistence/error-translator';
import type { Repos } from '../../../src/persistence/repositories';
import { performBackup } from '../../../src/plugins/message-backup/internal/perform-backup';

/**
 * Recording stand-in for the transcript sink. Substituted for the real
 * file-backed log so a pass writes no `logs/backup/` artifact and the
 * lines it would have written stay assertable.
 */
const { transcripts } = vi.hoisted(() => ({
  transcripts: [] as {
    kind: 'file' | 'null';
    path?: string;
    lines: string[];
    closed: boolean;
  }[],
}));

vi.mock('../../../src/plugins/message-backup/internal/backup-log', () => {
  class RecordingLog {
    private readonly entry: (typeof transcripts)[number];
    constructor(kind: 'file' | 'null', path?: string) {
      this.entry = { kind, path, lines: [], closed: false };
      transcripts.push(this.entry);
    }
    writeln(line = ''): void {
      this.entry.lines.push(line);
    }
    close(): void {
      this.entry.closed = true;
    }
  }
  return {
    BackupLog: class extends RecordingLog {
      constructor(filePath: string) {
        super('file', filePath);
      }
    },
    NullBackupLog: class extends RecordingLog {
      constructor() {
        super('null');
      }
    },
  };
});

const GUILD = 'g-1';

const dbErr = () => err(databaseErrorFrom(new Error('boom'), { operation: 'test' }));

/** Logger whose `error` calls are observable through the `logError` child. */
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

const message = (id: string): unknown => ({
  id,
  author: { bot: false, id: 'u-1', username: 'alice' },
  content: `content-${id}`,
  createdTimestamp: 1_700_000_000_000,
  attachments: new Map(),
  reactions: { cache: new Map() },
  stickers: new Map(),
});

interface ChannelSpec {
  readonly id: string;
  readonly name?: string;
  readonly type?: ChannelType;
  /** Message ids the channel's single page returns. */
  readonly messageIds?: readonly string[];
  /** When set, `messages.fetch` rejects with this instead of returning a page. */
  readonly fetchError?: Error;
}

const buildBackupChannel = (spec: ChannelSpec): unknown => ({
  id: spec.id,
  name: spec.name ?? `chan-${spec.id}`,
  type: spec.type ?? ChannelType.GuildText,
  messages: {
    fetch: vi.fn(async () => {
      if (spec.fetchError !== undefined) throw spec.fetchError;
      const messages = (spec.messageIds ?? []).map((id) => message(id));
      return { size: messages.length, values: () => messages };
    }),
  },
});

interface HarnessInput {
  readonly guildInCache?: boolean;
  readonly repos?: Repos | undefined;
  /** Replaces the default sendable debug channel. */
  readonly debugChannel?: unknown;
  /** Models a guild whose config names no debug channel. */
  readonly noDebugChannel?: boolean;
  readonly channels?: readonly ChannelSpec[];
  readonly existingCount?: number;
  readonly finalCount?: number;
  readonly countAllFails?: boolean;
  /** Fails only the closing count, after every channel has been walked. */
  readonly finalCountFails?: boolean;
  readonly listMarkersFails?: boolean;
  readonly deleteMarkerFails?: boolean;
  /** Channel ids that already carry a persisted `Fetch` marker. */
  readonly markerChannelIds?: readonly string[];
  /** Resume point every walked channel already holds, forcing incremental mode. */
  readonly resumeFrom?: string;
  /** Error `client.channels.fetch` rejects with, keyed by channel id. */
  readonly channelFetchErrors?: Readonly<Record<string, unknown>>;
  readonly writeTranscript?: boolean;
}

interface Harness {
  readonly run: () => Promise<void>;
  readonly send: ReturnType<typeof vi.fn>;
  readonly edit: ReturnType<typeof vi.fn>;
  readonly deleteByChannelId: ReturnType<typeof vi.fn>;
  readonly clientChannelFetch: ReturnType<typeof vi.fn>;
  readonly errorLog: ReturnType<typeof vi.fn>;
  readonly transcript: () => { lines: string[]; closed: boolean; kind: string } | undefined;
}

const notFoundError = (): DiscordAPIError => {
  const e = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  (e as { code: number }).code = 10003;
  return e;
};

const harness = (input: HarnessInput = {}): Harness => {
  const edit = vi.fn(async () => undefined);
  const send = vi.fn(async () => ({ edit }));
  const debugChannel =
    input.noDebugChannel === true
      ? undefined
      : (input.debugChannel ?? { isSendable: () => true, send });

  const guildChannels = (input.channels ?? []).map(buildBackupChannel);
  const guild = {
    id: GUILD,
    channels: {
      fetch: vi.fn(async () => undefined),
      cache: new Map(guildChannels.map((c) => [(c as { id: string }).id, c])),
    },
  };

  let counted = 0;
  const countAll = vi.fn(async () => {
    if (input.countAllFails === true) return dbErr();
    counted += 1;
    if (counted === 1) return ok(input.existingCount ?? 0);
    if (input.finalCountFails === true) return dbErr();
    return ok(input.finalCount ?? 0);
  });
  const deleteByChannelId = vi.fn(async () =>
    input.deleteMarkerFails === true ? dbErr() : ok(true),
  );
  const defaultRepos = {
    fetch: {
      listChannelIds: vi.fn(async () =>
        input.listMarkersFails === true ? dbErr() : ok(input.markerChannelIds ?? []),
      ),
      findByChannelId: vi.fn(async () =>
        ok(input.resumeFrom === undefined ? undefined : { lastMessageID: input.resumeFrom }),
      ),
      create: vi.fn(async () => ok({ lastMessageID: '' })),
      upsertLastMessageID: vi.fn(async () => ok(undefined)),
      deleteByChannelId,
    },
    message: {
      countAll,
      findExistingMessageIds: vi.fn(async () => ok(new Set<string>())),
      insertManyIgnoringDuplicates: vi.fn(async (docs: readonly unknown[]) =>
        ok({ inserted: docs.length, duplicates: 0 }),
      ),
    },
  } as unknown as Repos;
  const repos = 'repos' in input ? input.repos : defaultRepos;

  const registry = {
    getRepos: () => repos,
    getChannel: () => debugChannel,
    getRole: () => undefined,
    listGuildIds: () => [GUILD],
  } as unknown as GuildRegistry;

  const clientChannelFetch = vi.fn(async (id: string) => {
    const thrown = input.channelFetchErrors?.[id];
    if (thrown !== undefined) throw thrown;
    return null;
  });
  const client = {
    guilds: { cache: new Map(input.guildInCache === false ? [] : [[GUILD, guild]]) },
    channels: { fetch: clientChannelFetch },
  } as unknown as Client;

  const { logger, error } = makeLogger();
  const startIndex = transcripts.length;
  return {
    send,
    edit,
    deleteByChannelId,
    clientChannelFetch,
    errorLog: error,
    transcript: () => transcripts[startIndex],
    run: () => performBackup(GUILD, registry, client, logger, input.writeTranscript ?? false),
  };
};

afterEach(() => {
  transcripts.length = 0;
  vi.clearAllMocks();
});

describe('performBackup — preconditions', () => {
  it('does nothing when the guild is not in the client cache', async () => {
    const h = harness({ guildInCache: false });

    await h.run();

    expect(h.send).not.toHaveBeenCalled();
    expect(h.transcript()).toBeUndefined();
  });

  it('does nothing when the guild has no repository hookup', async () => {
    const h = harness({ repos: undefined });

    await h.run();

    expect(h.send).not.toHaveBeenCalled();
    expect(h.errorLog).toHaveBeenCalled();
  });

  it('does nothing when the debug channel is unresolved', async () => {
    const h = harness({ noDebugChannel: true });

    await h.run();

    expect(h.send).not.toHaveBeenCalled();
    expect(h.errorLog).toHaveBeenCalled();
  });

  it('does nothing when the debug channel cannot be posted to', async () => {
    const send = vi.fn();
    const h = harness({ debugChannel: { isSendable: () => false, send } });

    await h.run();

    expect(send).not.toHaveBeenCalled();
    expect(h.errorLog).toHaveBeenCalled();
  });

  it('opens no transcript at all when a precondition fails', async () => {
    // The sink truncates on open, so a pass that cannot run must not
    // replace the previous run's artifact with an empty file.
    await harness({ repos: undefined }).run();

    expect(transcripts).toHaveLength(0);
  });
});

describe('performBackup — a completed pass', () => {
  it('announces the starting count and closes with the new total and duration', async () => {
    const h = harness({
      existingCount: 10,
      finalCount: 12,
      channels: [{ id: 'c1', messageIds: ['100', '101'] }],
    });

    await h.run();

    expect(h.send).toHaveBeenCalledWith('[ SYSTEM ] Backup started. DB contains 10 messages.');
    const finalEdit = h.edit.mock.calls.at(-1)?.[0] as string;
    expect(finalEdit).toContain('Backup complete. DB now contains (10+2) messages.');
    expect(finalEdit).not.toContain('stale channel record');
  });

  it('edits the status message as channels report progress', async () => {
    const h = harness({ existingCount: 10, channels: [{ id: 'c1', messageIds: ['100'] }] });

    await h.run();

    expect(h.edit.mock.calls[0]?.[0]).toContain('Backup in progress');
  });

  it('writes a per-channel section and an overview into the transcript', async () => {
    const h = harness({
      existingCount: 10,
      finalCount: 12,
      channels: [{ id: 'c1', name: 'general', messageIds: ['100', '101'] }],
    });

    await h.run();

    const lines = h.transcript()?.lines ?? [];
    expect(lines).toContain('Channels/threads to backup (1 total):');
    expect(lines.some((l) => l.includes('[001] #general') && l.includes('c1'))).toBe(true);
    expect(lines).toContain('Mode:       full (initial backup)');
    expect(lines).toContain('New in DB:  2');
    expect(lines).toContain('=== OVERVIEW ===');
    expect(lines).toContain('New messages total:     2');
    expect(lines).toContain('DB count before:        10');
    expect(lines).toContain('DB count after:         12');
    expect(h.transcript()?.closed).toBe(true);
  });

  it('names the resume point in the transcript for an incremental channel', async () => {
    // The mode line is how an operator tells a resumed pass from a
    // first-ever walk when explaining an unexpectedly small run.
    const h = harness({ resumeFrom: '500', channels: [{ id: 'c1', messageIds: ['600'] }] });

    await h.run();

    expect(h.transcript()?.lines).toContain('Mode:       incremental (resume from 500)');
  });

  it('says so in the transcript when a channel yielded nothing', async () => {
    const h = harness({ channels: [{ id: 'c1', messageIds: [] }] });

    await h.run();

    expect(h.transcript()?.lines).toContain('Messages:   (none fetched this run)');
  });

  it('uses the no-op sink when transcript logging is off', async () => {
    const h = harness({ channels: [{ id: 'c1', messageIds: ['100'] }] });

    await h.run();

    expect(h.transcript()?.kind).toBe('null');
  });

  it('opens a per-guild file under logs/backup when transcript logging is on', async () => {
    const h = harness({ writeTranscript: true, channels: [{ id: 'c1', messageIds: ['100'] }] });

    await h.run();

    expect(h.transcript()?.kind).toBe('file');
    expect(transcripts[0]?.path).toContain(`msg-archive-${GUILD}-`);
  });
});

describe('performBackup — channel isolation', () => {
  it('backs up the remaining channels after one of them fails', async () => {
    const h = harness({
      existingCount: 0,
      finalCount: 2,
      channels: [
        { id: 'c1', name: 'broken', fetchError: new Error('Missing Access') },
        { id: 'c2', name: 'healthy', messageIds: ['100', '101'] },
      ],
    });

    await h.run();

    const lines = h.transcript()?.lines ?? [];
    expect(lines.some((l) => l.startsWith('ERROR:') && l.includes('Missing Access'))).toBe(true);
    expect(lines).toContain('Channels with errors:   1');
    // The healthy channel still ran, and its rows reached the tally.
    expect(lines).toContain('New messages total:     2');
    expect(h.edit.mock.calls.at(-1)?.[0]).toContain('(0+2)');
  });

  it('counts every enumerated channel in the overview, failures included', async () => {
    const h = harness({
      channels: [
        { id: 'c1', fetchError: new Error('boom') },
        { id: 'c2', messageIds: ['100'] },
      ],
    });

    await h.run();

    expect(h.transcript()?.lines).toContain('Channels processed:     2');
  });
});

describe('performBackup — stale marker sweep', () => {
  it('drops a marker only once Discord confirms the channel is gone', async () => {
    const h = harness({
      channels: [{ id: 'c1', messageIds: [] }],
      markerChannelIds: ['c1', 'deleted-1'],
      channelFetchErrors: { 'deleted-1': notFoundError() },
    });

    await h.run();

    // The live channel is never re-fetched; only the orphan marker is.
    expect(h.clientChannelFetch).toHaveBeenCalledTimes(1);
    expect(h.clientChannelFetch).toHaveBeenCalledWith('deleted-1', { force: true });
    expect(h.deleteByChannelId).toHaveBeenCalledWith('deleted-1');
    expect(h.edit.mock.calls.at(-1)?.[0]).toContain('Removed 1 stale channel record(s).');
  });

  it('keeps a marker whose channel merely failed to load', async () => {
    // A permission error or a transport blip is not proof of deletion;
    // dropping the marker would force a full re-walk of that channel.
    const h = harness({
      channels: [],
      markerChannelIds: ['unreadable'],
      channelFetchErrors: { unreadable: new Error('Missing Access') },
    });

    await h.run();

    expect(h.deleteByChannelId).not.toHaveBeenCalled();
    expect(h.transcript()?.lines).toContain('Stale channels removed: 0');
  });

  it('keeps a marker whose channel still resolves', async () => {
    const h = harness({ channels: [], markerChannelIds: ['orphan-but-alive'] });

    await h.run();

    expect(h.clientChannelFetch).toHaveBeenCalledWith('orphan-but-alive', { force: true });
    expect(h.deleteByChannelId).not.toHaveBeenCalled();
  });
});

describe('performBackup — pass-level failure', () => {
  it('records a fatal error in the transcript and still closes it', async () => {
    const h = harness({ countAllFails: true, channels: [{ id: 'c1', messageIds: ['100'] }] });

    await expect(h.run()).resolves.toBeUndefined();

    const transcript = h.transcript();
    expect(transcript?.lines.some((l) => l.startsWith('FATAL ERROR:'))).toBe(true);
    expect(transcript?.closed).toBe(true);
    expect(h.errorLog).toHaveBeenCalled();
  });

  it.each([
    ['the marker listing fails', { listMarkersFails: true }],
    ['the closing count fails', { finalCountFails: true }],
  ])('records a fatal error when %s, after the channels were walked', async (_label, failure) => {
    // The channels are already archived at this point; the pass must
    // report the failure rather than lose the transcript it built.
    const h = harness({ ...failure, channels: [{ id: 'c1', messageIds: ['100'] }] });

    await expect(h.run()).resolves.toBeUndefined();

    const transcript = h.transcript();
    expect(transcript?.lines).toContain('New in DB:  1');
    expect(transcript?.lines.some((l) => l.startsWith('FATAL ERROR:'))).toBe(true);
    expect(transcript?.closed).toBe(true);
  });

  it('records a fatal error when a confirmed-stale marker cannot be deleted', async () => {
    const h = harness({
      channels: [],
      markerChannelIds: ['deleted-1'],
      channelFetchErrors: { 'deleted-1': notFoundError() },
      deleteMarkerFails: true,
    });

    await expect(h.run()).resolves.toBeUndefined();

    expect(h.deleteByChannelId).toHaveBeenCalledWith('deleted-1');
    expect(h.transcript()?.lines.some((l) => l.startsWith('FATAL ERROR:'))).toBe(true);
  });

  it('leaves the status message untouched when the pass dies before it exists', async () => {
    const h = harness({ countAllFails: true });

    await h.run();

    expect(h.send).not.toHaveBeenCalled();
    expect(h.edit).not.toHaveBeenCalled();
  });
});
