/**
 * Per-handle polling cursor for the x-media-feed plugin. One document
 * per tracked X (Twitter) account, recording the newest post already
 * forwarded so a restart does not re-post the backlog.
 *
 * The guild is implicit — each guild owns its own database — so the
 * handle alone is the key, and the unique index enforces it.
 *
 * `last_seen_id` is a String because X post ids are 64-bit and exceed
 * `Number.MAX_SAFE_INTEGER`; storing them as a Number would collapse
 * distinct ids. Comparisons go through `BigInt` at the read site.
 */
import { Schema, type InferSchemaType, type Types } from 'mongoose';

export const xFeedCursorSchema = new Schema({
  handle: { type: String, required: true, unique: true },
  last_seen_id: { type: String, required: true },
  last_seen_timestamp: { type: Number, required: true },
});

export type XFeedCursorDoc = InferSchemaType<typeof xFeedCursorSchema> & {
  readonly _id: Types.ObjectId;
};
