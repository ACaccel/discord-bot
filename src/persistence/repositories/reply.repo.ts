/**
 * `ReplyRepo` — auto-reply pair storage. One per guild; pairs are
 * keyed by an exact-match `input` and produce a `reply` string.
 *
 * Phase 2 scope: covers every call site currently using
 * `db.models["Reply"]` (add_reply, delete_reply, list_reply, plus the
 * delete_reply SSM that uses ObjectId-by-string lookups). PR B will
 * switch those call sites over.
 */
import type { GuildConnection } from '../../infra/mongo/connection-manager';
import type { ReplyDoc } from '../schemas/reply.schema';

export interface ReplyRepo {
  /** Exact-pair existence check (used by add_reply to dedupe). */
  findExactPair(input: string, reply: string): Promise<readonly ReplyDoc[]>;

  /** All replies registered under `input`. */
  findByInput(input: string): Promise<readonly ReplyDoc[]>;

  /** Find by Mongoose `_id` rendered as a string (delete_reply SSM). */
  findById(id: string): Promise<ReplyDoc | undefined>;

  /** Create a new pair and return the persisted doc. */
  create(input: string, reply: string): Promise<ReplyDoc>;

  /** Delete by `_id`; returns true when a document was removed. */
  deleteById(id: string): Promise<boolean>;
}

export class MongoReplyRepo implements ReplyRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async findExactPair(input: string, reply: string): Promise<readonly ReplyDoc[]> {
    return this.conn.models.Reply.find({ input, reply }).lean<ReplyDoc[]>().exec();
  }

  public async findByInput(input: string): Promise<readonly ReplyDoc[]> {
    return this.conn.models.Reply.find({ input }).lean<ReplyDoc[]>().exec();
  }

  public async findById(id: string): Promise<ReplyDoc | undefined> {
    const doc = await this.conn.models.Reply.findById(id).lean<ReplyDoc>().exec();
    return doc ?? undefined;
  }

  public async create(input: string, reply: string): Promise<ReplyDoc> {
    const doc = await this.conn.models.Reply.create({ input, reply });
    return doc.toObject<ReplyDoc>();
  }

  public async deleteById(id: string): Promise<boolean> {
    const res = await this.conn.models.Reply.findByIdAndDelete(id).exec();
    return res !== null;
  }
}
