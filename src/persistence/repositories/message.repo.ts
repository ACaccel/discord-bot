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
 * the raw stored shape; rebranding the embedded id fields is a Phase 3
 * concern when domain-doc types land alongside the error taxonomy.
 *
 * Repos do **not** wrap mongoose errors in this PR. The Phase 3 error
 * taxonomy (DatabaseError + sub-codes) will own that. For Phase 2,
 * mongoose errors bubble unchanged.
 */
import type { ChannelId } from '../../core/ids';
import type { GuildConnection } from '../../infra/mongo/connection-manager';
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
}

/** Mongoose-backed implementation. */
export class MongoMessageRepo implements MessageRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async countAll(): Promise<number> {
    return this.conn.models.Message.countDocuments({}).exec();
  }

  public async findRecentByChannel(
    channelId: ChannelId,
    limit: number,
  ): Promise<readonly MessageDoc[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new TypeError(
        `MongoMessageRepo.findRecentByChannel: limit must be a positive integer, got ${limit}`,
      );
    }
    // Branded `ChannelId` is structurally a `string` at runtime — no
    // explicit unbrand needed at the mongoose call site.
    const docs = await this.conn.models.Message.find({ channelId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean<MessageDoc[]>()
      .exec();
    return docs;
  }

  public async findByMessageId(messageId: string): Promise<MessageDoc | undefined> {
    const doc = await this.conn.models.Message.findOne({ messageId }).lean<MessageDoc>().exec();
    return doc ?? undefined;
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
      // TODO(phase-3): replace duck-typed BulkWriteError handling with
      // a typed DatabaseError translation (sub-code DUPLICATE_KEY).
      // Mongoose throws BulkWriteError when any doc collides; the
      // partial insert count is on `err.insertedDocs`.
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
      throw err;
    }
  }
}
