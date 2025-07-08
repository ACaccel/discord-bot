import mongoose, { Schema } from "mongoose";

let string_field = {
    type: String,
    required: true
};

let number_field = {
    type: Number,
    required: true
};

// Define schema structures once
const fetchSchema = new Schema({
    channel: string_field,
    channelID: string_field,
    lastMessageID: string_field
});

const messageSchema = new Schema({
    username: string_field,
    userID: string_field,
    channel: string_field,
    channelID: string_field,
    content: string_field,
    messageID: string_field,
    timestamp: string_field
});

const replySchema = new Schema({
    // _id: String,
    input: string_field,
    reply: string_field
});

const todoSchema = new Schema({
    content: string_field
});

const giveawaySchema = new Schema({
    winner_num: number_field,
    prize: string_field,
    end_time: number_field,
    channel_id: string_field,
    prize_owner_id: string_field,
    participants: [string_field],
    message_id: string_field
});

export const Fetch = mongoose.model('Fetch', fetchSchema);
export const Message = mongoose.model('Message', messageSchema);
export const Reply = mongoose.model('Reply', replySchema);
export const Todo = mongoose.model('Todo', todoSchema);
export const Giveaway = mongoose.model('Giveaway', giveawaySchema);