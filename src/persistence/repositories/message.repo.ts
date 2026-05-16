/**
 * `MessageRepo` — persistence boundary for archived Discord messages.
 *
 * Methods are intent-named (`findRecentByChannel`, `countAll`,
 * `insertManyIgnoringDuplicates`) rather than generic CRUD so the repo
 * stays domain-shaped: a future swap to a different storage layer would
 * not change call sites.
 *
 * Inputs use branded ID types from `@core/ids` so a `UserId` cannot be
 * passed where a `ChannelId` is expected. Returned `MessageDoc` carries
 * the raw stored shape; rebranding the embedded id fields is a Phase 4
 * concern when domain-doc types land alongside the plugin layer.
 *
 * **Error wrapping (Phase 3)**: mongoose errors are translated into
 * typed `DatabaseError` instances by the shared `databaseErrorFrom`
 * translator in `infra/mongo/error-translator.ts`. Callers see typed
 * errors with stable sub-codes (`DATABASE_DUPLICATE_KEY`,
 * `DATABASE_TIMEOUT`, ...), the original mongoose error preserved on
 * `cause`, and a `context.operation` field naming the failing repo
 * method. Programmer errors (TypeError from input validation) still
 * bubble unwrapped — they are not a domain failure mode.
 */
import type { ChannelId } from '../../core/ids';
import type { GuildConnection } from '../../infra/mongo/connection-manager';
import { databaseErrorFrom } from '../../infra/mongo/error-translator';
import type { MessageDoc } from '../schemas/message.schema';

export interface InsertResult {
  /** How many of the requested docs were actually written. */
  readonly inserted: number;
  /** How many were skipped due to a duplicate `messageId`. */
  readonly duplicates: number;
}

export interface MessageRepo {
  /** Total document count for this guild. Used by msg-archive metrics. */
  countAll(): Promise<number>;

  /**
   * Recent messages from a single channel, newest first. `limit` clamps
   * the result; pass a positive integer.
   */
  findRecentByChannel(channelId: ChannelId, limit: number): Promise<readonly MessageDoc[]>;

  /**
   * Look up a single message by its Discord id. Returns `undefined` when
   * not stored — `noUncheckedIndexedAccess` makes undefined the
   * project-wide "absent" return shape.
   */
  findByMessageId(messageId: string): Promise<MessageDoc | undefined>;

  /**
   * Bulk insert with duplicate-key tolerance — the underlying call is
   * `insertMany(docs, { ordered: false })` so a duplicate `messageId`
   * does not abort the batch. Returns counts so callers can advance
   * progress markers without re-counting.
   */
  insertManyIgnoringDuplicates(docs: readonly MessageDoc[]): Promise<InsertResult>;

  /**
   * Messages whose `timestamp` falls within `[startMs, endMs)`, across
   * every channel in this guild. Used by the sticker/emoji-frequency
   * metrics commands that walk a month at a time. `startMs` / `endMs`
   * are millisecond epochs.
   */
  findByTimestampRange(startMs: number, endMs: number): Promise<readonly MessageDoc[]>;

  /**
   * Messages from a single channel whose `timestamp` falls within
   * `[startMs, endMs)`, sorted oldest-first. Used by `db_list_message`
   * to render a chronological transcript of one channel/day.
   */
  findByChannelAndTimestampRange(
    channelId: ChannelId,
    startMs: number,
    endMs: number,
  ): Promise<readonly MessageDoc[]>;

  /**
   * Subset of `messageIds` that are already stored in this guild's
   * collection. The msg-archive batch path uses this to filter
   * already-seen messages before calling `insertManyIgnoringDuplicates`
   * — Mongo's duplicate-key fallback is correct but expensive, the
   * pre-filter avoids the round-trip when most messages are already
   * known (the steady-state condition for an incremental backup).
   * Returns a Set so callers can do `O(1)` membership checks.
   */
  findExistingMessageIds(messageIds: readonly string[]): Promise<ReadonlySet<string>>;
}

/** Mongoose-backed implementation. */
export class MongoMessageRepo implements MessageRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async countAll(): Promise<number> {
    try {
      return await this.conn.models.Message.countDocuments({}).exec();
    } catch (err: unknown) {
      throw databaseErrorFrom(err, { operation: 'MongoMessageRepo.countAll' });
    }
  }

  public async findRecentByChannel(
    channelId: ChannelId,
    limit: number,
  ): Promise<readonly MessageDoc[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      // Programmer error — not a domain failure mode. Bubble unwrapped.
      throw new TypeError(
        `MongoMessageRepo.findRecentByChannel: limit must be a positive integer, got ${limit}`,
      );
    }
    try {
      // Branded `ChannelId` is structurally a `string` at runtime — no
      // explicit unbrand needed at the mongoose call site.
      const docs = await this.conn.models.Message.find({ channelId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean<MessageDoc[]>()
        .exec();
      return docs;
    } catch (err: unknown) {
      throw databaseErrorFrom(err, {
        operation: 'MongoMessageRepo.findRecentByChannel',
        input: { channelId: String(channelId), limit },
      });
    }
  }

  public async findByMessageId(messageId: string): Promise<MessageDoc | undefined> {
    try {
      const doc = await this.conn.models.Message.findOne({ messageId }).lean<MessageDoc>().exec();
      return doc ?? undefined;
    } catch (err: unknown) {
      throw databaseErrorFrom(err, {
        operation: 'MongoMessageRepo.findByMessageId',
        input: { messageId },
      });
    }
  }

  public async insertManyIgnoringDuplicates(docs: readonly MessageDoc[]): Promise<InsertResult> {
    if (docs.length === 0) {
      return { inserted: 0, duplicates: 0 };
    }
    try {
      const inserted = await this.conn.models.Message.insertMany([...docs], {
        ordered: false,
      });
      return { inserted: inserted.length, duplicates: docs.length - inserted.length };
    } catch (err: unknown) {
      // Mongoose throws BulkWriteError on duplicate-key conflicts; the
      // partial-success count is on `err.insertedDocs`. That is the
      // *expected* path for this method's contract — return success
      // with the partial count rather than translating to DatabaseError.
      // Any other error shape is genuinely abnormal and is wrapped.
      if (
        typeof err === 'object' &&
        err !== null &&
        'insertedDocs' in err &&
        Array.isArray((err as { insertedDocs: unknown }).insertedDocs)
      ) {
        const insertedDocs = (err as { insertedDocs: readonly unknown[] }).insertedDocs;
        return {
          inserted: insertedDocs.length,
          duplicates: docs.length - insertedDocs.length,
        };
      }
      throw databaseErrorFrom(err, {
        operation: 'MongoMessageRepo.insertManyIgnoringDuplicates',
        input: { batchSize: docs.length },
      });
    }
  }

  public async findByTimestampRange(
    startMs: number,
    endMs: number,
  ): Promise<readonly MessageDoc[]> {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      throw new TypeError(
        `MongoMessageRepo.findByTimestampRange: invalid window [${startMs}, ${endMs})`,
      );
    }
    try {
      // The stored `timestamp` field is a String per the legacy
      // schema; the `$toLong` projection makes the comparison
      // numeric, matching the original handler queries.
      const docs = await this.conn.models.Message.find({
        $expr: {
          $and: [
            { $gte: [{ $toLong: '$timestamp' }, startMs] },
            { $lt: [{ $toLong: '$timestamp' }, endMs] },
          ],
        },
      })
        .lean<MessageDoc[]>()
        .exec();
      return docs;
    } catch (err: unknown) {
      throw databaseErrorFrom(err, {
        operation: 'MongoMessageRepo.findByTimestampRange',
        input: { startMs, endMs },
      });
    }
  }

  public async findExistingMessageIds(messageIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (messageIds.length === 0) return new Set<string>();
    try {
      const docs = await this.conn.models.Message.find(
        { messageId: { $in: [...messageIds] } },
        { messageId: 1 },
      )
        .lean<Array<{ messageId: string }>>()
        .exec();
      return new Set(docs.map((d) => d.messageId));
    } catch (err: unknown) {
      throw databaseErrorFrom(err, {
        operation: 'MongoMessageRepo.findExistingMessageIds',
        input: { count: messageIds.length },
      });
    }
  }

  public async findByChannelAndTimestampRange(
    channelId: ChannelId,
    startMs: number,
    endMs: number,
  ): Promise<readonly MessageDoc[]> {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      throw new TypeError(
        `MongoMessageRepo.findByChannelAndTimestampRange: invalid window [${startMs}, ${endMs})`,
      );
    }
    try {
      const docs = await this.conn.models.Message.find({
        channelId,
        $expr: {
          $and: [
            { $gte: [{ $toLong: '$timestamp' }, startMs] },
            { $lt: [{ $toLong: '$timestamp' }, endMs] },
          ],
        },
      })
        .sort({ timestamp: 1 })
        .lean<MessageDoc[]>()
        .exec();
      return docs;
    } catch (err: unknown) {
      throw databaseErrorFrom(err, {
        operation: 'MongoMessageRepo.findByChannelAndTimestampRange',
        input: { channelId: String(channelId), startMs, endMs },
      });
    }
  }
}
