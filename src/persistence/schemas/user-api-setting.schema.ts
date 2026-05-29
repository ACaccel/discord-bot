/**
 * Per-user AI API settings. A document's existence also acts as a
 * whitelist entry; the use case layer checks for presence before any
 * LLM call.
 */
import { Schema, type InferSchemaType, type Types } from 'mongoose';

// Schema-level defaults are only a safety net: `ai_whitelist_add` always
// writes a full document via `buildWhitelistDefaults`. They mirror that
// xAI-first intent so a partial insert never lands on a stale provider.
// The model id is a static seed (persistence must not import the infra
// `DEFAULT_MODELS` constant — layering forbids it); the live default is
// kept fresh by `DefaultModelResolver`.
export const userApiSettingSchema = new Schema({
  userId: { type: String, required: true, unique: true, index: true },
  provider: { type: String, required: true, default: 'xai' },
  model: { type: String, required: true, default: 'grok-4-1-fast-non-reasoning' },
  temperature: { type: Number, required: true, default: 1.0 },
  system_prompt: { type: String, required: false, default: '' },
  web_search: { type: Boolean, required: true, default: true },
});

export type UserApiSettingDoc = InferSchemaType<typeof userApiSettingSchema> & {
  readonly _id: Types.ObjectId;
};
