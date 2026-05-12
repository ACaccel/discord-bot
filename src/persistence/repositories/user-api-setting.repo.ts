/**
 * `UserApiSettingRepo` — per-user AI provider configuration. Document
 * existence doubles as whitelist membership; the LLM-chat handler
 * checks `findByUserId` before any external API call.
 *
 * Update semantics intentionally mirror the legacy mongoose call
 * (`updateOne($set: patch)`) — partial updates of provider, model,
 * temperature, system_prompt, and web_search.
 */
import type { GuildConnection } from '../../infra/mongo/connection-manager';
import type { UserApiSettingDoc } from '../schemas/user-api-setting.schema';

/** Defaults applied when adding a new whitelist entry. */
export interface UserApiSettingDefaults {
  readonly provider: string;
  readonly model: string;
  readonly temperature: number;
  readonly system_prompt: string;
  readonly web_search: boolean;
}

/** Subset of fields permitted by the settings modal. */
export interface UserApiSettingPatch {
  readonly provider?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly system_prompt?: string;
  readonly web_search?: boolean;
}

export interface UserApiSettingRepo {
  /** Look up a user's settings; returns undefined when not whitelisted. */
  findByUserId(userId: string): Promise<UserApiSettingDoc | undefined>;
  /** Every whitelist entry — used by ai_whitelist_list. */
  listAll(): Promise<readonly UserApiSettingDoc[]>;
  /** Create a whitelist entry with defaults. Caller must dedupe via findByUserId. */
  create(userId: string, defaults: UserApiSettingDefaults): Promise<UserApiSettingDoc>;
  /** Apply a partial update; returns true when a document was matched. */
  update(userId: string, patch: UserApiSettingPatch): Promise<boolean>;
  /** Remove a whitelist entry; returns true when a document was removed. */
  deleteByUserId(userId: string): Promise<boolean>;
}

export class MongoUserApiSettingRepo implements UserApiSettingRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async findByUserId(userId: string): Promise<UserApiSettingDoc | undefined> {
    const doc = await this.conn.models.UserApiSetting.findOne({ userId })
      .lean<UserApiSettingDoc>()
      .exec();
    return doc ?? undefined;
  }

  public async listAll(): Promise<readonly UserApiSettingDoc[]> {
    return this.conn.models.UserApiSetting.find({}).lean<UserApiSettingDoc[]>().exec();
  }

  public async create(
    userId: string,
    defaults: UserApiSettingDefaults,
  ): Promise<UserApiSettingDoc> {
    const created = await this.conn.models.UserApiSetting.create({ userId, ...defaults });
    return created.toObject<UserApiSettingDoc>();
  }

  public async update(userId: string, patch: UserApiSettingPatch): Promise<boolean> {
    const res = await this.conn.models.UserApiSetting.updateOne({ userId }, { $set: patch }).exec();
    return res.matchedCount > 0;
  }

  public async deleteByUserId(userId: string): Promise<boolean> {
    const res = await this.conn.models.UserApiSetting.deleteOne({ userId }).exec();
    return res.deletedCount > 0;
  }
}
