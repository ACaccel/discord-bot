/**
 * `GiveawayRepo` — persistent state for the giveaway feature.
 *
 * Documents are keyed by the announcement Discord `message_id`. The
 * scheduler reads pending giveaways on boot, the announcement creates
 * one, and the schedule callback (or a manual cancel) deletes it.
 *
 * Phase 4b's GiveawayPlugin will consume this same interface.
 */
import type { GuildConnection } from '../../infra/mongo/connection-manager';
import type { GiveawayDoc } from '../schemas/giveaway.schema';

/** Insertion shape — the schema fields without the Mongoose `_id`. */
export interface GiveawayInput {
  readonly winner_num: number;
  readonly prize: string;
  readonly end_time: number;
  readonly channel_id: string;
  readonly prize_owner_id: string;
  readonly participants: readonly string[];
  readonly message_id: string;
}

export interface GiveawayRepo {
  /** Every giveaway in this guild, used for boot-time job rebuild. */
  listAll(): Promise<readonly GiveawayDoc[]>;
  /** Look up by announcement message id; returns undefined when absent. */
  findByMessageId(message_id: string): Promise<GiveawayDoc | undefined>;
  /** Persist a new giveaway and return the stored doc. */
  create(input: GiveawayInput): Promise<GiveawayDoc>;
  /** Delete by announcement message id; returns true when a doc was removed. */
  deleteByMessageId(message_id: string): Promise<boolean>;
}

export class MongoGiveawayRepo implements GiveawayRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async listAll(): Promise<readonly GiveawayDoc[]> {
    return this.conn.models.Giveaway.find({}).lean<GiveawayDoc[]>().exec();
  }

  public async findByMessageId(message_id: string): Promise<GiveawayDoc | undefined> {
    const doc = await this.conn.models.Giveaway.findOne({ message_id }).lean<GiveawayDoc>().exec();
    return doc ?? undefined;
  }

  public async create(input: GiveawayInput): Promise<GiveawayDoc> {
    const created = await this.conn.models.Giveaway.create({ ...input });
    return created.toObject<GiveawayDoc>();
  }

  public async deleteByMessageId(message_id: string): Promise<boolean> {
    const res = await this.conn.models.Giveaway.deleteOne({ message_id }).exec();
    return res.deletedCount > 0;
  }
}
