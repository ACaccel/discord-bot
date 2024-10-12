import mongoose from 'mongoose';
import utils from '../utils';
import * as schema from './schema';

const dbConnect = async(mongoURI: string, bot_id: string) => {
    utils.consoleLogger("Connecting to MongoDB...", bot_id);
    await mongoose.connect(mongoURI).then(() => {
        utils.consoleLogger("Connected to MongoDB", bot_id);
    });
}

const db = {
    dbConnect,
    ...schema
}

export default db;