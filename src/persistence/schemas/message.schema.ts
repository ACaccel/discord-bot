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
// `db migrate-timestamp` backfill made every timestamp numeric.
messageSchema.index({ timestamp: 1 });
messageSchema.index({ channelId: 1, timestamp: 1 });

export type MessageDoc = InferSchemaType<typeof messageSchema> & {
  readonly _id: Types.ObjectId;
};

/**
 * The element type of a mongoose `DocumentArray`, i.e. the plain object
 * a caller constructs for the write path. Derived rather than
 * hand-copied so a field added to {@link messageSchema} cannot silently
 * go unwritten.
 */
type SubdocOf<A> = A extends Types.DocumentArray<infer R> ? R : never;

/**
 * A message as handed to `insertMany`, which differs from a stored
 * {@link MessageDoc} in two ways: Mongo has not assigned an `_id` yet,
 * and the three nested arrays are plain arrays (a stored doc's are
 * mongoose `DocumentArray`s, which a caller cannot construct) that may
 * be omitted entirely. Omission is how the backup path declines to
 * persist a half-formed array — a member missing its `name` could not
 * be rendered or correlated later — and costs nothing, because an
 * omitted array is stored as `[]`.
 */
export type NewMessageDoc = Omit<MessageDoc, '_id' | 'attachments' | 'reactions' | 'stickers'> & {
  attachments?: SubdocOf<MessageDoc['attachments']>[];
  reactions?: SubdocOf<MessageDoc['reactions']>[];
  stickers?: SubdocOf<MessageDoc['stickers']>[];
};
