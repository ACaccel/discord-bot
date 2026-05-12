import { Schema, type InferSchemaType, type Types } from 'mongoose';

export const giveawaySchema = new Schema({
  winner_num: { type: Number, required: true },
  prize: { type: String, required: true },
  end_time: { type: Number, required: true },
  channel_id: { type: String, required: true },
  prize_owner_id: { type: String, required: true },
  participants: [{ type: String, required: true }],
  message_id: { type: String, required: true },
});

export type GiveawayDoc = InferSchemaType<typeof giveawaySchema> & {
  readonly _id: Types.ObjectId;
};
