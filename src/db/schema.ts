import mongoose, { Schema, Document, Model } from "mongoose";

let string_field = {
    type: String,
    required: true
};

let number_field = {
    type: Number,
    required: true
};

// Define schema structures once
const fetchSchema = {
    channel: string_field,
    channelID: string_field,
    lastMessageID: string_field
};

const messageSchema = {
    username: string_field,
    userID: string_field,
    channel: string_field,
    channelID: string_field,
    content: string_field,
    messageID: string_field,
    timestamp: string_field
};

const replySchema = {
    input: string_field,
    reply: string_field
};

const todoSchema = {
    content: string_field
};

const giveawaySchema = {
    winner_num: number_field,
    prize: string_field,
    end_time: number_field,
    channel_id: string_field,
    prize_owner_id: string_field,
    participants: [string_field],
    message_id: string_field
};

// Create document type interfaces from schema structures
type IFetch = Document & typeof fetchSchema;
type IMessage = Document & typeof messageSchema;
type IReply = Document & typeof replySchema;
type ITodo = Document & typeof todoSchema;
type IGiveaway = Document & typeof giveawaySchema;

// Create models using the schema structures
export const Fetch = mongoose.model<IFetch>('Fetch', new Schema(fetchSchema));
export const Message = mongoose.model<IMessage>('Message', new Schema(messageSchema));
export const Reply = mongoose.model<IReply>('Reply', new Schema(replySchema));
export const Todo = mongoose.model<ITodo>('Todo', new Schema(todoSchema));
export const Giveaway = mongoose.model<IGiveaway>('Giveaway', new Schema(giveawaySchema));