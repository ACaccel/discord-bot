import mongoose, { Schema } from "mongoose";

const fetchSchema = new Schema({
    channel: { type: String, required: true },
    channelID: { type: String, required: true },
    lastMessageID: { type: String, required: true }
});

const messageSchema = new Schema({
    channelId: { type: String, required: true },    // channel & thread
    channelName: { type: String, required: true },
    content: String,
    messageId: { type: String, required: true },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    attachments: [{
        id: String,
        name: String,
        url: String,
        contentType: String
    }],
    reactions: [{
        id: String,
        name: String,
        animated: Boolean,
        count: Number,
        userIds: [String]
    }],
    stickers: [{
        id: String,
        name: String,
    }],
    timestamp: { type: Number, required: true },
});

const replySchema = new Schema({
    input: { type: String, required: true },
    reply: { type: String, required: true }
});

const todoSchema = new Schema({
    content: { type: String, required: true }
});

const giveawaySchema = new Schema({
    winner_num: { type: Number, required: true },
    prize: { type: String, required: true },
    end_time: { type: Number, required: true },
    channel_id: { type: String, required: true },
    prize_owner_id: { type: String, required: true },
    participants: [{ type: String, required: true }],
    message_id: { type: String, required: true }
});

const activitySchema = new Schema({
    activity_id: { type: String, required: true },
    message_id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: false },
    expired_at: { type: Number, required: true },
    channel_id: { type: String, required: true },
    participants: [{ type: String, required: true }]
});

// const holidaySchema = new Schema({
//     date: { type: String, required: true },
//     name: { type: String, required: true },
//     holiday: { type: Boolean, required: true },
//     username: { type: String, required: false }
// })

export const Fetch = mongoose.model('Fetch', fetchSchema);
export const Message = mongoose.model('Message', messageSchema);
export const Reply = mongoose.model('Reply', replySchema);
export const Todo = mongoose.model('Todo', todoSchema);
export const Giveaway = mongoose.model('Giveaway', giveawaySchema);
export const Activity = mongoose.model('Activity', activitySchema);
// export const Holiday = mongoose.model('Holiday', holidaySchema);