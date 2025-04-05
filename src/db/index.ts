import mongoose from 'mongoose';
import * as schema from './schema';

const dbConnect = async (mongoURI: string, guild_id: string, bot_id: string) => {
    const modifiedURI = mongoURI.replace('/?', `/${guild_id}?`);
    const connection = await mongoose.createConnection(modifiedURI).asPromise();
    const models = Object.keys(schema).reduce((acc, modelName) => {
        acc[modelName] = connection.model(modelName, (schema as any)[modelName].schema);
        return acc;
    }, {} as Record<string, mongoose.Model<any>>);

    return {
        connection,
        models
    };
};

const db = {
    dbConnect,
    ...schema
}

export default db;