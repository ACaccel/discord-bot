/**
 * `XFeedCursorRepo` — polling cursors for the x-media-feed plugin, one
 * document per tracked X (Twitter) handle.
 *
 * The poller reads a handle's cursor before each pass and advances it
 * only after the matching posts have actually been delivered, so a
 * failed send is retried on the next pass rather than skipped.
 *
 * Error boundary: every method returns `Result<T, DatabaseError>`. A
 * mongoose failure is translated by the shared `databaseErrorFrom`
 * translator and returned as `err`; a missing lookup is a success
 * (`ok(undefined)`) — the first pass for a new handle has no cursor.
 */
import type { DatabaseError } from '../../core/errors/external-service-error';
import { err, ok, type Result } from '../../core/result';
import type { GuildConnection } from '../../infra/mongo/connection-manager';
import { databaseErrorFrom } from '../error-translator';
import type { XFeedCursorDoc } from '../schemas/x-feed-cursor.schema';

export interface XFeedCursorRepo {
  /** Look up a handle's cursor; `ok(undefined)` before the first pass. */
  findByHandle(handle: string): Promise<Result<XFeedCursorDoc | undefined, DatabaseError>>;
  /**
   * Move a handle's cursor forward, creating it when absent. Idempotent
   * so the poller does not need a create-versus-update branch.
   */
  upsert(
    handle: string,
    last_seen_id: string,
    last_seen_timestamp: number,
  ): Promise<Result<void, DatabaseError>>;
  /**
   * Every stored handle in this guild, used by the startup
   * reconciliation to find cursors whose account was removed from the
   * configuration.
   */
  listHandles(): Promise<Result<readonly string[], DatabaseError>>;
  /** Delete a handle's cursor; `ok(true)` when a doc was removed. */
  deleteByHandle(handle: string): Promise<Result<boolean, DatabaseError>>;
}

export class MongoXFeedCursorRepo implements XFeedCursorRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async findByHandle(
    handle: string,
  ): Promise<Result<XFeedCursorDoc | undefined, DatabaseError>> {
    try {
      const doc = await this.conn.models.XFeedCursor.findOne({ handle })
        .lean<XFeedCursorDoc>()
        .exec();
      return ok(doc ?? undefined);
    } catch (rawErr: unknown) {
      return err(
        databaseErrorFrom(rawErr, {
          operation: 'MongoXFeedCursorRepo.findByHandle',
          input: { handle },
        }),
      );
    }
  }

  public async upsert(
    handle: string,
    last_seen_id: string,
    last_seen_timestamp: number,
  ): Promise<Result<void, DatabaseError>> {
    try {
      await this.conn.models.XFeedCursor.updateOne(
        { handle },
        { $set: { last_seen_id, last_seen_timestamp } },
        { upsert: true },
      ).exec();
      return ok(undefined);
    } catch (rawErr: unknown) {
      return err(
        databaseErrorFrom(rawErr, {
          operation: 'MongoXFeedCursorRepo.upsert',
          input: { handle, last_seen_id },
        }),
      );
    }
  }

  public async listHandles(): Promise<Result<readonly string[], DatabaseError>> {
    try {
      const docs = await this.conn.models.XFeedCursor.find({}, { handle: 1 })
        .lean<Array<Pick<XFeedCursorDoc, 'handle'>>>()
        .exec();
      return ok(docs.map((d) => d.handle));
    } catch (rawErr: unknown) {
      return err(databaseErrorFrom(rawErr, { operation: 'MongoXFeedCursorRepo.listHandles' }));
    }
  }

  public async deleteByHandle(handle: string): Promise<Result<boolean, DatabaseError>> {
    try {
      const res = await this.conn.models.XFeedCursor.deleteOne({ handle }).exec();
      return ok(res.deletedCount > 0);
    } catch (rawErr: unknown) {
      return err(
        databaseErrorFrom(rawErr, {
          operation: 'MongoXFeedCursorRepo.deleteByHandle',
          input: { handle },
        }),
      );
    }
  }
}
