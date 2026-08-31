/**
 * Unit tests for one message-backup page write.
 *
 * `saveBatch` is the only place a Discord message is translated into a
 * stored document, so the invariants pinned here are the archive's data
 * contract: which messages are persisted at all (humans only, never a
 * duplicate), what each stored row carries, and — because the caller
 * paginates on them — that the returned id bounds are computed as
 * snowflake magnitudes rather than as strings.
 *
 * The second half is the null-omission contract. A Discord page can
 * carry a half-formed attachment, reaction, or sticker; the whole
 * array is dropped rather than the whole row, because a message with
 * no attachment list is still worth archiving and a rejected insert is
 * not recoverable on a later pass.
 */
import { describe, expect, it, vi } from 'vitest';

import { databaseErrorFrom } from '../../../src/persistence/error-translator';
import { err, ok } from '../../../src/core/result';
import type { MessageRepo } from '../../../src/persistence/repositories';
import type { NewMessageDoc } from '../../../src/persistence/schemas/message.schema';
import { saveBatch } from '../../../src/plugins/message-backup/internal/save-batch';

const CHANNEL = { id: 'chan-1', name: 'general' };

const dbErr = () => err(databaseErrorFrom(new Error('boom'), { operation: 'test' }));

interface FakeAttachment {
  readonly id: string;
  readonly name: string | null;
  readonly url: string;
  readonly contentType?: string | null;
}

interface FakeReaction {
  readonly emoji: { id?: string; name?: string | null; animated?: boolean } | null;
  readonly count: number;
  readonly userIds?: readonly string[];
}

interface FakeMessageInput {
  readonly id: string;
  /** Omitting the author models a deleted webhook / removed cross-post source. */
  readonly authorless?: boolean;
  readonly bot?: boolean;
  readonly userId?: string;
  readonly userName?: string;
  readonly content?: string;
  /** Models a message whose body is absent (an attachment-only post). */
  readonly contentless?: boolean;
  readonly createdTimestamp?: number;
  readonly attachments?: readonly FakeAttachment[];
  readonly reactions?: readonly FakeReaction[];
  readonly stickers?: readonly { id: string; name: string | null }[];
}

/**
 * A discord.js `Message` reduced to the fields `saveBatch` reads. The
 * collection-shaped fields stay real `Map`s so the production iteration
 * (`.values()`, `.keys()`) runs unchanged.
 */
const message = (input: FakeMessageInput): unknown => ({
  id: input.id,
  author:
    input.authorless === true
      ? undefined
      : {
          bot: input.bot ?? false,
          id: input.userId ?? 'user-1',
          username: input.userName ?? 'alice',
        },
  content: input.contentless === true ? undefined : (input.content ?? `content-${input.id}`),
  createdTimestamp: input.createdTimestamp ?? 1_700_000_000_000,
  attachments: new Map((input.attachments ?? []).map((a) => [a.id, a])),
  reactions: {
    cache: new Map(
      (input.reactions ?? []).map((r, i) => [
        String(i),
        {
          emoji: r.emoji,
          count: r.count,
          users: { cache: new Map((r.userIds ?? []).map((u) => [u, {}])) },
        },
      ]),
    ),
  },
  stickers: new Map((input.stickers ?? []).map((s) => [s.id, s])),
});

const page = (...messages: unknown[]): { values: () => Iterable<unknown> } => ({
  values: () => messages,
});

interface MessageRepoFake {
  readonly repo: MessageRepo;
  readonly findExisting: ReturnType<typeof vi.fn>;
  readonly insertMany: ReturnType<typeof vi.fn>;
  /** Every document handed to the bulk write, flattened across calls. */
  readonly written: () => NewMessageDoc[];
}

const makeMessageRepo = (
  opts: {
    existing?: readonly string[];
    findFails?: boolean;
    insertFails?: boolean;
    /** Written rows the store silently rejected as duplicates. */
    duplicates?: number;
  } = {},
): MessageRepoFake => {
  const written: NewMessageDoc[] = [];
  const findExisting = vi.fn(async () =>
    opts.findFails === true ? dbErr() : ok(new Set(opts.existing ?? [])),
  );
  const insertMany = vi.fn(async (docs: readonly NewMessageDoc[]) => {
    if (opts.insertFails === true) return dbErr();
    written.push(...docs);
    const duplicates = opts.duplicates ?? 0;
    return ok({ inserted: docs.length - duplicates, duplicates });
  });
  return {
    findExisting,
    insertMany,
    written: () => written,
    repo: {
      findExistingMessageIds: findExisting,
      insertManyIgnoringDuplicates: insertMany,
    } as unknown as MessageRepo,
  };
};

describe('saveBatch — what gets persisted', () => {
  it('stores a human message as a fully-populated row and reports the write count', async () => {
    const { repo, written } = makeMessageRepo();

    const result = await saveBatch(
      page(
        message({
          id: '100',
          userId: 'u-7',
          userName: 'bob',
          content: 'hello',
          createdTimestamp: 1_699_000_000_000,
          attachments: [
            { id: 'a1', name: 'cat.png', url: 'https://cdn/cat.png', contentType: 'image/png' },
          ],
          reactions: [
            {
              emoji: { id: 'e1', name: 'wave', animated: false },
              count: 2,
              userIds: ['u-1', 'u-2'],
            },
          ],
          stickers: [{ id: 's1', name: 'party' }],
        }),
      ),
      CHANNEL,
      repo,
    );

    expect(result.inserted).toBe(1);
    expect(written()).toEqual([
      {
        channelId: 'chan-1',
        channelName: 'general',
        content: 'hello',
        messageId: '100',
        userId: 'u-7',
        userName: 'bob',
        timestamp: 1_699_000_000_000,
        attachments: [
          { id: 'a1', name: 'cat.png', url: 'https://cdn/cat.png', contentType: 'image/png' },
        ],
        reactions: [{ id: 'e1', name: 'wave', animated: false, count: 2, userIds: ['u-1', 'u-2'] }],
        stickers: [{ id: 's1', name: 'party' }],
      },
    ]);
  });

  it('falls back to empty strings for an unnamed channel and a contentless message', async () => {
    const { repo, written } = makeMessageRepo();

    await saveBatch(page(message({ id: '100', contentless: true })), { id: 'chan-9' }, repo);

    expect(written()[0]).toMatchObject({ channelName: '', channelId: 'chan-9', content: '' });
  });

  it('drops bot messages from the write and counts them separately', async () => {
    const { repo, written } = makeMessageRepo();

    const result = await saveBatch(
      page(message({ id: '100' }), message({ id: '101', bot: true })),
      CHANNEL,
      repo,
    );

    expect(result.skippedBots).toBe(1);
    expect(written().map((d) => d.messageId)).toEqual(['100']);
  });

  it('skips an authorless message without counting it as a bot or a duplicate', async () => {
    // A deleted webhook or removed cross-post source leaves `author`
    // unset; the row cannot be attributed, so it is dropped silently
    // rather than crashing the channel's whole backup.
    const { repo, written } = makeMessageRepo();

    const result = await saveBatch(
      page(message({ id: '100' }), message({ id: '101', authorless: true })),
      CHANNEL,
      repo,
    );

    expect(written().map((d) => d.messageId)).toEqual(['100']);
    expect(result.skippedBots).toBe(0);
    expect(result.skippedDuplicates).toBe(0);
  });

  it('pre-filters already-stored ids with a single index lookup over the whole page', async () => {
    const { repo, written, findExisting } = makeMessageRepo({ existing: ['101'] });

    const result = await saveBatch(
      page(message({ id: '100' }), message({ id: '101' }), message({ id: '102' })),
      CHANNEL,
      repo,
    );

    expect(findExisting).toHaveBeenCalledTimes(1);
    expect(findExisting).toHaveBeenCalledWith(['100', '101', '102']);
    expect(result.skippedDuplicates).toBe(1);
    expect(written().map((d) => d.messageId)).toEqual(['100', '102']);
  });

  it('skips the bulk write entirely when nothing survives the filters', async () => {
    const { repo, insertMany } = makeMessageRepo({ existing: ['101'] });

    const result = await saveBatch(
      page(message({ id: '100', bot: true }), message({ id: '101' })),
      CHANNEL,
      repo,
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ inserted: 0, skippedBots: 1, skippedDuplicates: 1 });
  });

  it('reports the store’s own duplicate absorption rather than the requested count', async () => {
    // `insertManyIgnoringDuplicates` resolves partial success when the
    // unique index rejects a row that raced in between the pre-filter
    // and the write; the caller's progress must follow the real count.
    const { repo } = makeMessageRepo({ duplicates: 1 });

    const result = await saveBatch(
      page(message({ id: '100' }), message({ id: '101' })),
      CHANNEL,
      repo,
    );

    expect(result.inserted).toBe(1);
  });
});

describe('saveBatch — page bounds', () => {
  it('compares ids as snowflake magnitudes, not as strings', async () => {
    // '1000' sorts before '999' lexically; getting this wrong would make
    // the caller's cursor walk backwards and re-fetch the same page.
    const { repo } = makeMessageRepo();

    const result = await saveBatch(
      page(message({ id: '999' }), message({ id: '1000' })),
      CHANNEL,
      repo,
    );

    expect(result.oldestId).toBe('999');
    expect(result.newestId).toBe('1000');
  });

  it('derives the page bounds from every fetched message, including skipped ones', async () => {
    // The cursor must step over bots and duplicates too, otherwise a
    // page that is entirely bots would stall the drain forever.
    const { repo } = makeMessageRepo({ existing: ['300'] });

    const result = await saveBatch(
      page(message({ id: '100', bot: true }), message({ id: '200' }), message({ id: '300' })),
      CHANNEL,
      repo,
    );

    expect(result.oldestId).toBe('100');
    expect(result.newestId).toBe('300');
  });

  it('reports the stored-message bounds from inserted rows only', async () => {
    // These feed the transcript's "from/to" preview, which describes
    // what the run actually archived — not what it looked at.
    const { repo } = makeMessageRepo({ existing: ['300'] });

    const result = await saveBatch(
      page(
        message({ id: '100', bot: true }),
        message({ id: '200', content: 'kept' }),
        message({ id: '300' }),
      ),
      CHANNEL,
      repo,
    );

    expect(result.oldestMsg).toEqual({ id: '200', content: 'kept' });
    expect(result.newestMsg).toEqual({ id: '200', content: 'kept' });
  });

  it('leaves every bound unset for an empty page', async () => {
    const { repo, findExisting } = makeMessageRepo();

    const result = await saveBatch(page(), CHANNEL, repo);

    expect(findExisting).toHaveBeenCalledWith([]);
    expect(result).toEqual({
      inserted: 0,
      skippedBots: 0,
      skippedDuplicates: 0,
      oldestId: undefined,
      newestId: undefined,
      oldestMsg: undefined,
      newestMsg: undefined,
    });
  });
});

describe('saveBatch — null-omission contract', () => {
  it('omits the attachment array when any attachment lacks a name, keeping the row', async () => {
    const { repo, written } = makeMessageRepo();

    await saveBatch(
      page(
        message({
          id: '100',
          attachments: [
            { id: 'a1', name: 'ok.png', url: 'https://cdn/ok.png' },
            { id: 'a2', name: null, url: 'https://cdn/broken' },
          ],
        }),
      ),
      CHANNEL,
      repo,
    );

    const doc = written()[0];
    expect(doc?.messageId).toBe('100');
    expect(doc).not.toHaveProperty('attachments');
  });

  it('omits the reaction array when an emoji is missing its name', async () => {
    const { repo, written } = makeMessageRepo();

    await saveBatch(
      page(message({ id: '100', reactions: [{ emoji: { id: 'e1' }, count: 1 }] })),
      CHANNEL,
      repo,
    );

    expect(written()[0]).not.toHaveProperty('reactions');
  });

  it('omits the reaction array when the emoji itself is absent', async () => {
    const { repo, written } = makeMessageRepo();

    await saveBatch(
      page(message({ id: '100', reactions: [{ emoji: null, count: 1 }] })),
      CHANNEL,
      repo,
    );

    expect(written()[0]).not.toHaveProperty('reactions');
  });

  it('omits the sticker array when a sticker lacks a name', async () => {
    const { repo, written } = makeMessageRepo();

    await saveBatch(
      page(message({ id: '100', stickers: [{ id: 's1', name: null }] })),
      CHANNEL,
      repo,
    );

    expect(written()[0]).not.toHaveProperty('stickers');
  });

  it('stores empty arrays when a message simply has no attachments or reactions', async () => {
    // The empty case is not the broken case: an omitted array and an
    // empty one both store as `[]`, but only the broken case may drop
    // data the message actually carried.
    const { repo, written } = makeMessageRepo();

    await saveBatch(page(message({ id: '100' })), CHANNEL, repo);

    expect(written()[0]).toMatchObject({ attachments: [], reactions: [], stickers: [] });
  });
});

describe('saveBatch — repository failures', () => {
  it('rethrows a failed duplicate lookup without attempting the write', async () => {
    const { repo, insertMany } = makeMessageRepo({ findFails: true });

    await expect(saveBatch(page(message({ id: '100' })), CHANNEL, repo)).rejects.toBeDefined();
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('rethrows a failed bulk write so the channel records the error', async () => {
    const { repo } = makeMessageRepo({ insertFails: true });

    await expect(saveBatch(page(message({ id: '100' })), CHANNEL, repo)).rejects.toBeDefined();
  });
});
