/**
 * Mongoose schema definitions.
 *
 * Each schema is declared once. Document types are derived via
 * `InferSchemaType` and re-exported from `./types.ts`. The list of all
 * schemas (the `SCHEMAS` registry) is consumed by `./models.ts` to build
 * a typed `Models` map for a per-guild connection.
 *
 * Convention: schemas are pure declarative data. No model registration
 * against the default mongoose connection happens here — that would
 * leak unused models into memory; real registration is per-guild via
 * `buildModels(connection)` in ./models.ts.
 */
import { Schema } from 'mongoose';

export const fetchSchema = new Schema({
  channel: { type: String, required: true },
  channelID: { type: String, required: true, index: true },
  lastMessageID: { type: String, required: false, default: '' },
});

export const messageSchema = new Schema({
  channelId: { type: String, required: true }, // channel & thread
  channelName: { type: String, required: true },
  content: { type: String, required: false },
  messageId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  attachments: [
    {
      id: { type: String, required: false },
      name: { type: String, required: false },
      url: { type: String, required: false },
      contentType: { type: String, required: false },
    },
  ],
  reactions: [
    {
      id: { type: String, required: false },
      name: { type: String, required: false },
      animated: { type: Boolean, required: false },
      count: { type: Number, required: false },
      userIds: [{ type: String, required: false }],
    },
  ],
  stickers: [
    {
      id: { type: String, required: false },
      name: { type: String, required: false },
    },
  ],
  timestamp: { type: Number, required: true },
});

export const replySchema = new Schema({
  input: { type: String, required: true },
  reply: { type: String, required: true },
});

export const todoSchema = new Schema({
  content: { type: String, required: true },
});

export const giveawaySchema = new Schema({
  winner_num: { type: Number, required: true },
  prize: { type: String, required: true },
  end_time: { type: Number, required: true },
  channel_id: { type: String, required: true },
  prize_owner_id: { type: String, required: true },
  participants: [{ type: String, required: true }],
  message_id: { type: String, required: true },
});

export const activitySchema = new Schema({
  activity_id: { type: String, required: true },
  message_id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: false },
  expired_at: { type: Number, required: true },
  channel_id: { type: String, required: true },
  participants: [{ type: String, required: true }],
});

/**
 * Per-user AI API settings. A document's existence also acts as a
 * whitelist entry; the use case layer checks for presence before any
 * LLM call.
 */
export const userApiSettingSchema = new Schema({
  userId: { type: String, required: true, unique: true, index: true },
  provider: { type: String, required: true, default: 'openai' },
  model: { type: String, required: true, default: 'gpt-4o' },
  temperature: { type: Number, required: true, default: 1.0 },
  system_prompt: { type: String, required: false, default: '' },
  web_search: { type: Boolean, required: true, default: false },
});

/**
 * Schema registry — the single source of truth for "which models exist".
 * Adding a model means adding a new schema above and a new line here;
 * the `Models` type in `./models.ts` is derived from this object so the
 * typed shape stays in lockstep automatically.
 */
export const SCHEMAS = {
  Fetch: fetchSchema,
  Message: messageSchema,
  Reply: replySchema,
  Todo: todoSchema,
  Giveaway: giveawaySchema,
  Activity: activitySchema,
  UserApiSetting: userApiSettingSchema,
} as const;

export type SchemaName = keyof typeof SCHEMAS;
