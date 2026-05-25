/**
 * `Fetch` tracks per-channel message-backup progress for the
 * msg-archive bot. One document per channel; `lastMessageID` advances
 * as the backup job consumes new messages.
 */
import { Schema, type InferSchemaType, type Types } from 'mongoose';

export const fetchSchema = new Schema({
  channel: { type: String, required: true },
  channelID: { type: String, required: true, index: true },
  lastMessageID: { type: String, required: false, default: '' },
});

export type FetchDoc = InferSchemaType<typeof fetchSchema> & {
  readonly _id: Types.ObjectId;
};
