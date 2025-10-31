import mongoose from 'mongoose';
import * as schema from './schema';

const dbConnect = async (mongoURI: string, guild_id: string) => {
    // const modifiedURI = mongoURI.replace('/?', `/${guild_id}?`);
    const modifiedURI = mongoURI + guild_id + '?authSource=admin';
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