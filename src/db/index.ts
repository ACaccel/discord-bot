/**
 * Per-guild MongoDB connection factory.
 *
 * Each guild runs against its own database (URI appended with the
 * guild id + `?authSource=admin`). `dbConnect` returns a typed
 * `Models` map built by `buildModels` so callers get
 * `Model<MessageDoc>` etc. instead of the old `Model<any>`.
 */
import mongoose, { type Connection } from 'mongoose';
import { buildModels, type Models } from './models';

export interface GuildDb {
  readonly connection: Connection;
  readonly models: Models;
}

/**
 * Build the per-guild MongoDB connection URI. Extracted so the URI
 * shape is testable in isolation and a malformed `guild_id` cannot
 * silently corrupt the URI via string concatenation.
 */
export const buildGuildMongoUri = (baseUri: string, guildId: string): string => {
  if (guildId.length === 0) {
    throw new TypeError('buildGuildMongoUri: guildId must be non-empty');
  }
  // Conservative validation — Discord snowflake ids are digit-only.
  if (!/^\d+$/.test(guildId)) {
    throw new TypeError(`buildGuildMongoUri: guildId must be all digits, got "${guildId}"`);
  }
  return `${baseUri}${guildId}?authSource=admin`;
};

export const dbConnect = async (mongoURI: string, guild_id: string): Promise<GuildDb> => {
  const modifiedURI = buildGuildMongoUri(mongoURI, guild_id);
  const connection = await mongoose.createConnection(modifiedURI).asPromise();
  const models = buildModels(connection);
  return { connection, models };
};

const db = { dbConnect };
export default db;

export { buildModels, type Models } from './models';
export type {
  FetchDoc,
  MessageDoc,
  ReplyDoc,
  TodoDoc,
  GiveawayDoc,
  ActivityDoc,
  UserApiSettingDoc,
  DocByName,
} from './types';
export { SCHEMAS, type SchemaName } from './schema';
