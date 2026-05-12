import { Schema, type InferSchemaType, type Types } from 'mongoose';

export const todoSchema = new Schema({
  content: { type: String, required: true },
});

export type TodoDoc = InferSchemaType<typeof todoSchema> & {
  readonly _id: Types.ObjectId;
};
