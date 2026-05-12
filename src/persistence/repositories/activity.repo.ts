/**
 * `ActivityRepo` — persistent state for the activity feature.
 *
 * Documents are keyed by `activity_id` (a timestamp string in current
 * usage). On schedule completion the participants list is updated and
 * the entry persists; explicit deletion comes from `deleteActivity`.
 *
 * Phase 4b's ActivityPlugin will consume this same interface.
 */
import type { GuildConnection } from '../../infra/mongo/connection-manager';
import type { ActivityDoc } from '../schemas/activity.schema';

export interface ActivityInput {
  readonly activity_id: string;
  readonly message_id: string;
  readonly title: string;
  readonly description: string;
  readonly expired_at: number;
  readonly channel_id: string;
  readonly participants: readonly string[];
}

export interface ActivityRepo {
  /** Every activity in this guild, used for boot-time job rebuild. */
  listAll(): Promise<readonly ActivityDoc[]>;
  /** Look up by activity id; returns undefined when absent. */
  findByActivityId(activity_id: string): Promise<ActivityDoc | undefined>;
  /** Persist a new activity and return the stored doc. */
  create(input: ActivityInput): Promise<ActivityDoc>;
  /** Replace the participants list for a given activity. Returns true on match. */
  setParticipants(activity_id: string, participants: readonly string[]): Promise<boolean>;
  /** Delete by activity id; returns true when a doc was removed. */
  deleteByActivityId(activity_id: string): Promise<boolean>;
}

export class MongoActivityRepo implements ActivityRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async listAll(): Promise<readonly ActivityDoc[]> {
    return this.conn.models.Activity.find({}).lean<ActivityDoc[]>().exec();
  }

  public async findByActivityId(activity_id: string): Promise<ActivityDoc | undefined> {
    const doc = await this.conn.models.Activity.findOne({ activity_id }).lean<ActivityDoc>().exec();
    return doc ?? undefined;
  }

  public async create(input: ActivityInput): Promise<ActivityDoc> {
    const created = await this.conn.models.Activity.create({ ...input });
    return created.toObject<ActivityDoc>();
  }

  public async setParticipants(
    activity_id: string,
    participants: readonly string[],
  ): Promise<boolean> {
    const res = await this.conn.models.Activity.updateOne(
      { activity_id },
      { $set: { participants: [...participants] } },
    ).exec();
    return res.matchedCount > 0;
  }

  public async deleteByActivityId(activity_id: string): Promise<boolean> {
    const res = await this.conn.models.Activity.deleteOne({ activity_id }).exec();
    return res.deletedCount > 0;
  }
}
