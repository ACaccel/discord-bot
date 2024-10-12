import mongoose from 'mongoose';
import utils from '../utils';
import * as schema from './schema';

const dbConnect = async(mongoURI: string) => {
    utils.consoleLogger("Connecting to MongoDB...");
    await mongoose.connect(mongoURI).then(() => {
        utils.consoleLogger("Connected to MongoDB");
    });
}

const db = {
    dbConnect,
    ...schema
}

export default db;