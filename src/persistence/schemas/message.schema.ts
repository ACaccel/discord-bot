/**
 * Discord message snapshot persisted by the msg-archive bot.
 *
 * `messageId` is unique — the backup job uses `insertMany({ ordered: false })`
 * and lets duplicate-key errors filter dupes without aborting the batch.
 */
import { Schema, type InferSchemaType, type Types } from 'mongoose';

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

export type MessageDoc = InferSchemaType<typeof messageSchema> & {
  readonly _id: Types.ObjectId;
};
