/**
 * Schema registry — single source of truth for "which models exist".
 *
 * Each schema lives in its own file so a future change to one schema
 * does not invite drive-by edits to the others.
 */
import { activitySchema, type ActivityDoc } from './activity.schema';
import { fetchSchema, type FetchDoc } from './fetch.schema';
import { giveawaySchema, type GiveawayDoc } from './giveaway.schema';
import { messageSchema, type MessageDoc } from './message.schema';
import { replySchema, type ReplyDoc } from './reply.schema';
import { tempRoleSchema, type TempRoleDoc } from './temp-role.schema';
import { userApiSettingSchema, type UserApiSettingDoc } from './user-api-setting.schema';

export { activitySchema, type ActivityDoc } from './activity.schema';
export { fetchSchema, type FetchDoc } from './fetch.schema';
export { giveawaySchema, type GiveawayDoc } from './giveaway.schema';
export { messageSchema, type MessageDoc } from './message.schema';
export { replySchema, type ReplyDoc } from './reply.schema';
export { tempRoleSchema, type TempRoleDoc } from './temp-role.schema';
export { userApiSettingSchema, type UserApiSettingDoc } from './user-api-setting.schema';

export const SCHEMAS = {
  Fetch: fetchSchema,
  Message: messageSchema,
  Reply: replySchema,
  Giveaway: giveawaySchema,
  Activity: activitySchema,
  TempRole: tempRoleSchema,
  UserApiSetting: userApiSettingSchema,
} as const;

export type SchemaName = keyof typeof SCHEMAS;

/**
 * Mapping from `SchemaName` to inferred doc type. Consumed by
 * `infra/mongo/connection-manager` to derive the typed Models map.
 */
export interface DocByName {
  Fetch: FetchDoc;
  Message: MessageDoc;
  Reply: ReplyDoc;
  Giveaway: GiveawayDoc;
  Activity: ActivityDoc;
  TempRole: TempRoleDoc;
  UserApiSetting: UserApiSettingDoc;
}
