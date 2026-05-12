/**
 * `FetchRepo` — per-channel backup-progress markers used by the
 * msg-archive bot. One document per channel records the most recent
 * Discord message id consumed; the next backup pass starts after it.
 *
 * Phase 2 PR B exposes the methods msg-archive currently calls; the
 * Phase 4b plugin rewrite (MessageBackupPlugin) consumes the same
 * interface, so this contract is intentionally narrow.
 */
import type { GuildConnection } from '../../infra/mongo/connection-manager';
import type { FetchDoc } from '../schemas/fetch.schema';

export interface FetchRepo {
  /** All progress markers in this guild, projected to `channelID`. */
  listChannelIds(): Promise<readonly string[]>;
  /** Look up a marker by channel id. Returns undefined when absent. */
  findByChannelId(channelID: string): Promise<FetchDoc | undefined>;
  /**
   * Insert a new progress marker. Caller is responsible for ensuring
   * uniqueness — schema-level `index: true` on `channelID` is not a
   * `unique` constraint, matching legacy behaviour.
   */
  create(channel: string, channelID: string, lastMessageID: string): Promise<FetchDoc>;
  /** Move the cursor forward; returns whether a document was matched. */
  setLastMessageID(channelID: string, lastMessageID: string): Promise<boolean>;
  /** Delete a marker; returns whether a document was removed. */
  deleteByChannelId(channelID: string): Promise<boolean>;
}

export class MongoFetchRepo implements FetchRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async listChannelIds(): Promise<readonly string[]> {
    const docs = await this.conn.models.Fetch.find({}, { channelID: 1 })
      .lean<Array<Pick<FetchDoc, 'channelID'>>>()
      .exec();
    return docs.map((d) => d.channelID);
  }

  public async findByChannelId(channelID: string): Promise<FetchDoc | undefined> {
    const doc = await this.conn.models.Fetch.findOne({ channelID }).lean<FetchDoc>().exec();
    return doc ?? undefined;
  }

  public async create(
    channel: string,
    channelID: string,
    lastMessageID: string,
  ): Promise<FetchDoc> {
    const created = await this.conn.models.Fetch.create({ channel, channelID, lastMessageID });
    return created.toObject<FetchDoc>();
  }

  public async setLastMessageID(channelID: string, lastMessageID: string): Promise<boolean> {
    // updateOne avoids the doc-fetch round-trip that findOneAndUpdate
    // pays for; we only care whether a doc was matched. Mirrors
    // MongoActivityRepo.setParticipants for consistency.
    const res = await this.conn.models.Fetch.updateOne(
      { channelID },
      { $set: { lastMessageID } },
    ).exec();
    return res.matchedCount > 0;
  }

  public async deleteByChannelId(channelID: string): Promise<boolean> {
    const res = await this.conn.models.Fetch.deleteOne({ channelID }).exec();
    return res.deletedCount > 0;
  }
}
