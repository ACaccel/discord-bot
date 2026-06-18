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

// Range-read indexes for the timestamp query paths (traffic stats,
// `db_list_message`). `{ timestamp: 1 }` serves the cross-channel range
// query; the compound `{ channelId: 1, timestamp: 1 }` serves the
// per-channel range query plus its `timestamp` sort (and covers
// `findRecentByChannel`'s reverse sort). These only become sargable once
// stored timestamps are uniformly numeric — the `MessageRepo` predicates
// were `$toLong`-wrapped for legacy String rows until the one-time
// `tools/migrate_timestamp` backfill made every timestamp numeric.
messageSchema.index({ timestamp: 1 });
messageSchema.index({ channelId: 1, timestamp: 1 });

export type MessageDoc = InferSchemaType<typeof messageSchema> & {
  readonly _id: Types.ObjectId;
};
