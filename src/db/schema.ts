import mongoose, { Schema, Document, Model } from "mongoose";

let string_field = {
    type: String,
    required: true
};

let number_field = {
    type: Number,
    required: true
};

interface IFetch extends Document {
    channel: string;
    channelID: string;
    lastMessageID: string;
}

interface IMessage extends Document {
    username: string;
    userID: string;
    channel: string;
    channelID: string;
    content: string;
    messageID: string;
    timestamp: string;
}

interface IReply extends Document {
    input: string;
    reply: string;
}

interface ITodo extends Document {
    content: string;
}

interface IRaffle extends Document {
    name: string;
    winner_num: number;
    description: string;
    end_time: number;
}

export const Fetch: Model<IFetch> = mongoose.model<IFetch>('Fetch', new Schema<IFetch>({
    channel: string_field,
    channelID: string_field,
    lastMessageID: string_field
}));

export const Message: Model<IMessage> = mongoose.model<IMessage>('Message', new Schema<IMessage>({
    username: string_field,
    userID: string_field,
    channel: string_field,
    channelID: string_field,
    content: string_field,
    messageID: string_field,
    timestamp: string_field
}));

export const Reply: Model<IReply> = mongoose.model<IReply>('Reply', new Schema<IReply>({
    input: string_field,
    reply: string_field
}));

export const Todo: Model<ITodo> = mongoose.model<ITodo>('Todo', new Schema<ITodo>({
    content: string_field
}));

export const Raffle: Model<IRaffle> = mongoose.model<IRaffle>('Raffle', new Schema<IRaffle>({
    name: string_field,
    winner_num: number_field,
    description: string_field,
    end_time: number_field
}));