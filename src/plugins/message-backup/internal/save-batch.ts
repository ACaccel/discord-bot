/**
 * Transform a discord.js MessageManager.fetch result into the
 * persistence-layer document shape and bulk-insert via
 * `insertManyIgnoringDuplicates`. Bot messages are dropped; already-
 * stored messages are filtered out with a single index lookup before
 * the bulk write (audit C-1: pre-filter is an optimisation, not a
 * correctness gate — the unique index on `messageId` plus
 * `insertManyIgnoringDuplicates` would already absorb a double-write).
 */
import type { MessageRepo } from '../../../persistence/repositories';
import type { MessageDoc } from '../../../persistence/schemas/message.schema';

export interface BatchResult {
  inserted: number;
  skippedBots: number;
  skippedDuplicates: number;
  oldestId?: string;
  newestId?: string;
  oldestMsg?: { id: string; content: string };
  newestMsg?: { id: string; content: string };
}

export const saveBatch = async (
  fetched: { values: () => Iterable<unknown> },
  ch: { id: string; name?: string },
  messageRepo: MessageRepo,
): Promise<BatchResult> => {
  const messages = [...fetched.values()] as Array<{
    id: string;
    author?: { bot?: boolean; id: string; username: string };
    content?: string;
    attachments: Map<string, { id: string; name: string; url: string; contentType?: string | null }>;
    reactions: {
      cache: Map<
        string,
        { emoji: { id?: string; name?: string; animated?: boolean }; count: number; users: { cache: Map<string, unknown> } }
      >;
    };
    stickers: Map<string, { id: string; name: string }>;
    createdTimestamp: number;
  }>;

  const ids: string[] = [];
  let oldestId: string | undefined;
  let newestId: string | undefined;
  for (const msg of messages) {
    ids.push(msg.id);
    if (oldestId === undefined || BigInt(msg.id) < BigInt(oldestId)) oldestId = msg.id;
    if (newestId === undefined || BigInt(msg.id) > BigInt(newestId)) newestId = msg.id;
  }

  // G-2: repo methods return Result<T, DatabaseError>. An `err` is
  // re-thrown so `backupChannel`'s catch records it on `stats.error` —
  // behaviour-equivalent to the pre-G-2 raw-error propagation.
  const existingResult = await messageRepo.findExistingMessageIds(ids);
  if (!existingResult.ok) throw existingResult.error;
  const existingSet = existingResult.value;

  let skippedBots = 0;
  let skippedDuplicates = 0;
  let oldestMsg: { id: string; content: string } | undefined;
  let newestMsg: { id: string; content: string } | undefined;
  const toInsert: unknown[] = [];

  for (const msg of messages) {
    if (msg.author?.bot === true) {
      skippedBots += 1;
      continue;
    }
    if (existingSet.has(msg.id)) {
      skippedDuplicates += 1;
      continue;
    }
    const content = msg.content ?? '';
    if (oldestMsg === undefined || BigInt(msg.id) < BigInt(oldestMsg.id)) {
      oldestMsg = { id: msg.id, content };
    }
    if (newestMsg === undefined || BigInt(msg.id) > BigInt(newestMsg.id)) {
      newestMsg = { id: msg.id, content };
    }
    toInsert.push({
      channelId: ch.id,
      channelName: ch.name ?? '',
      content,
      messageId: msg.id,
      userId: msg.author!.id,
      userName: msg.author!.username,
      attachments: [...msg.attachments.values()].map((a) => ({
        id: a.id,
        name: a.name,
        url: a.url,
        contentType: a.contentType,
      })),
      reactions: [...msg.reactions.cache.values()].map((r) => ({
        id: r.emoji.id,
        name: r.emoji.name,
        animated: r.emoji.animated,
        count: r.count,
        userIds: [...r.users.cache.keys()],
      })),
      stickers: [...msg.stickers.values()].map((s) => ({ id: s.id, name: s.name })),
      timestamp: msg.createdTimestamp,
    });
  }

  if (toInsert.length === 0) {
    return { inserted: 0, skippedBots, skippedDuplicates, oldestId, newestId, oldestMsg, newestMsg };
  }

  // `insertManyIgnoringDuplicates` already absorbs a duplicate-key
  // BulkWriteError into a partial-success count (see message.repo.ts);
  // only a genuine Mongo failure resolves to `err`, which is re-thrown
  // for `backupChannel`'s catch.
  const insertResult = await messageRepo.insertManyIgnoringDuplicates(
    toInsert as unknown as readonly MessageDoc[],
  );
  if (!insertResult.ok) throw insertResult.error;
  const { inserted } = insertResult.value;
  return { inserted, skippedBots, skippedDuplicates, oldestId, newestId, oldestMsg, newestMsg };
};
