/**
 * Document types inferred from the Mongoose schemas. Centralised here so
 * downstream code (repositories in Phase 2, use cases in Phase 2+) can
 * import the doc shapes without pulling in the schema objects.
 *
 * Each `*Doc` type is the schema's `InferSchemaType` widened with the
 * Mongoose `_id` field that every persisted document carries.
 */
import type { InferSchemaType, Types } from 'mongoose';
import type {
  activitySchema,
  fetchSchema,
  giveawaySchema,
  messageSchema,
  replySchema,
  todoSchema,
  userApiSettingSchema,
} from './schema';

type WithId<T> = T & { readonly _id: Types.ObjectId };

export type FetchDoc = WithId<InferSchemaType<typeof fetchSchema>>;
export type MessageDoc = WithId<InferSchemaType<typeof messageSchema>>;
export type ReplyDoc = WithId<InferSchemaType<typeof replySchema>>;
export type TodoDoc = WithId<InferSchemaType<typeof todoSchema>>;
export type GiveawayDoc = WithId<InferSchemaType<typeof giveawaySchema>>;
export type ActivityDoc = WithId<InferSchemaType<typeof activitySchema>>;
export type UserApiSettingDoc = WithId<InferSchemaType<typeof userApiSettingSchema>>;

/**
 * Mapping from schema-registry key (`SchemaName`) to inferred doc type.
 * Used by `Models` in `./models.ts` to derive `Model<DocType>` for each
 * registered schema without a manual cast.
 */
export interface DocByName {
  Fetch: FetchDoc;
  Message: MessageDoc;
  Reply: ReplyDoc;
  Todo: TodoDoc;
  Giveaway: GiveawayDoc;
  Activity: ActivityDoc;
  UserApiSetting: UserApiSettingDoc;
}
