import { Schema, type InferSchemaType, type Types } from 'mongoose';

export const activitySchema = new Schema({
  activity_id: { type: String, required: true },
  message_id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: false },
  expired_at: { type: Number, required: true },
  channel_id: { type: String, required: true },
  participants: [{ type: String, required: true }],
});

export type ActivityDoc = InferSchemaType<typeof activitySchema> & {
  readonly _id: Types.ObjectId;
};
