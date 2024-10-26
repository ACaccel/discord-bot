import mongoose from 'mongoose';
import utils from '../utils';
import * as schema from './schema';

const dbConnect = async(mongoURI: string, bot_id: string) => {
    utils.systemLogger(bot_id, "Connecting to MongoDB...");
    await mongoose.connect(mongoURI).then(() => {
        utils.systemLogger(bot_id, "Connected to MongoDB");
    });
}

const db = {
    dbConnect,
    ...schema
}

export default db;