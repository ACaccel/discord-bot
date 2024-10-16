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

interface IUser extends Document {
    username: string;
    level: string;
}

// Schemas
const FetchSchema = new Schema<IFetch>({
    channel: string_field,
    channelID: string_field,
    lastMessageID: string_field
});

const MessageSchema = new Schema<IMessage>({
    username: string_field,
    userID: string_field,
    channel: string_field,
    channelID: string_field,
    content: string_field,
    messageID: string_field,
    timestamp: string_field
});

const ReplySchema = new Schema<IReply>({
    input: string_field,
    reply: string_field
});

const TodoSchema = new Schema<ITodo>({
    content: string_field
});

const UserSchema = new Schema<IUser>({
    username: string_field,
    level: string_field
});

// Models
const Message: Model<IMessage> = mongoose.model<IMessage>('Message', MessageSchema);
const Reply: Model<IReply> = mongoose.model<IReply>('Reply', ReplySchema);
const Todo: Model<ITodo> = mongoose.model<ITodo>('Todo', TodoSchema);
const Fetch: Model<IFetch> = mongoose.model<IFetch>('Fetch', FetchSchema);
const User: Model<IUser> = mongoose.model<IUser>('User', UserSchema);

export {
    Message,
    Reply,
    Todo,
    Fetch,
    User
};
