/**
 * Per-user AI API settings. A document's existence also acts as a
 * whitelist entry; the use case layer checks for presence before any
 * LLM call.
 */
import { Schema, type InferSchemaType, type Types } from 'mongoose';

export const userApiSettingSchema = new Schema({
  userId: { type: String, required: true, unique: true, index: true },
  provider: { type: String, required: true, default: 'openai' },
  model: { type: String, required: true, default: 'gpt-4o' },
  temperature: { type: Number, required: true, default: 1.0 },
  system_prompt: { type: String, required: false, default: '' },
  web_search: { type: Boolean, required: true, default: false },
});

export type UserApiSettingDoc = InferSchemaType<typeof userApiSettingSchema> & {
  readonly _id: Types.ObjectId;
};
