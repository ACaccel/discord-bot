/**
 * Transform a discord.js MessageManager.fetch result into the
 * persistence-layer document shape and bulk-insert via
 * `insertManyIgnoringDuplicates`. Bot messages are dropped; already-
 * stored messages are filtered out with a single index lookup before
 * the bulk write. The pre-filter is an optimisation, not a
 * correctness gate — the unique index on `messageId` plus
 * `insertManyIgnoringDuplicates` already absorbs a double-write.
 */
import type { MessageRepo } from '../../../persistence/repositories';
import type { NewMessageDoc } from '../../../persistence/schemas/message.schema';

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
    attachments: Map<
      string,
      { id: string; name: string; url: string; contentType?: string | null }
    >;
    reactions: {
      cache: Map<
        string,
        {
          emoji: { id?: string; name?: string; animated?: boolean };
          count: number;
          users: { cache: Map<string, unknown> };
        }
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

  // Repo methods return Result<T, DatabaseError>. An `err` is
  // re-thrown so `backupChannel`'s catch records it on `stats.error`.
  const existingResult = await messageRepo.findExistingMessageIds(ids);
  if (!existingResult.ok) throw existingResult.error;
  const existingSet = existingResult.value;

  let skippedBots = 0;
  let skippedDuplicates = 0;
  let oldestMsg: { id: string; content: string } | undefined;
  let newestMsg: { id: string; content: string } | undefined;
  const toInsert: NewMessageDoc[] = [];

  for (const msg of messages) {
    // Defensive guard against `msg.author === null` — webhook deleted
    // / cross-post source removed / very old system messages can
    // legitimately have a null author. Skip them rather than crashing
    // the whole channel's backup. Mirrors the `msg_backup` tool.
    if (msg.author === undefined || msg.author === null) {
      continue;
    }
    if (msg.author.bot === true) {
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
    // Build the doc with the same null-omission contract msg_backup
    // uses: if any nested array element has a critical null
    // field, OMIT the whole array so mongoose's schema validation does
    // not silently reject the entire insert. Omitting on insert defaults
    // to an empty array — better than dropping the whole row.
    const baseDoc: NewMessageDoc = {
      channelId: ch.id,
      channelName: ch.name ?? '',
      content,
      messageId: msg.id,
      userId: msg.author.id,
      userName: msg.author.username,
      timestamp: msg.createdTimestamp,
    };

    let attachmentArr: NonNullable<NewMessageDoc['attachments']> | null = [];
    for (const a of msg.attachments.values()) {
      if (a === null || a === undefined || a.name === null || a.name === undefined) {
        attachmentArr = null;
        break;
      }
      attachmentArr.push({
        id: a.id,
        name: a.name,
        url: a.url,
        contentType: a.contentType,
      });
    }
    if (attachmentArr !== null) baseDoc.attachments = attachmentArr;

    let reactionArr: NonNullable<NewMessageDoc['reactions']> | null = [];
    for (const r of msg.reactions.cache.values()) {
      if (r === null || r === undefined || r.emoji === null || r.emoji === undefined) {
        reactionArr = null;
        break;
      }
      if (r.emoji.name === null || r.emoji.name === undefined) {
        reactionArr = null;
        break;
      }
      reactionArr.push({
        id: r.emoji.id,
        name: r.emoji.name,
        animated: r.emoji.animated,
        count: r.count,
        userIds: [...r.users.cache.keys()],
      });
    }
    if (reactionArr !== null) baseDoc.reactions = reactionArr;

    let stickerArr: NonNullable<NewMessageDoc['stickers']> | null = [];
    for (const s of msg.stickers.values()) {
      if (s === null || s === undefined || s.name === null || s.name === undefined) {
        stickerArr = null;
        break;
      }
      stickerArr.push({ id: s.id, name: s.name });
    }
    if (stickerArr !== null) baseDoc.stickers = stickerArr;

    toInsert.push(baseDoc);
  }

  if (toInsert.length === 0) {
    return {
      inserted: 0,
      skippedBots,
      skippedDuplicates,
      oldestId,
      newestId,
      oldestMsg,
      newestMsg,
    };
  }

  // `insertManyIgnoringDuplicates` already absorbs a duplicate-key
  // BulkWriteError into a partial-success count (see message.repo.ts);
  // only a genuine Mongo failure resolves to `err`, which is re-thrown
  // for `backupChannel`'s catch.
  const insertResult = await messageRepo.insertManyIgnoringDuplicates(toInsert);
  if (!insertResult.ok) throw insertResult.error;
  const { inserted } = insertResult.value;
  return { inserted, skippedBots, skippedDuplicates, oldestId, newestId, oldestMsg, newestMsg };
};
