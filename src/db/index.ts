/**
 * @deprecated Thin compatibility shim over `infra/mongo/connection-manager`.
 *
 * Legacy call sites use `db.dbConnect(uri, guildId)` and then read
 * `bot.guildInfo[g].db.models["X"]`. The connection lifecycle now lives
 * in {@link MongoConnectionManager}; this file preserves the legacy
 * one-shot factory so those call sites keep compiling. New code MUST
 * inject a `ConnectionManager` (or repository) instead of importing
 * `db.dbConnect` directly.
 *
 * Removed in Phase 4b.
 */
import type { Connection } from 'mongoose';
import { asGuildId, type GuildId } from '../core/ids';
import { MongoConnectionManager, buildGuildMongoUri, type Models } from '../infra/mongo';

export interface GuildDb {
  readonly connection: Connection;
  readonly models: Models;
}

/**
 * One {@link MongoConnectionManager} per distinct base URI.
 *
 * Lazy and keyed-by-URI so:
 *   - importing `@db` does not require `MONGO_URI` at module-evaluation time;
 *   - tests or hypothetical multi-cluster setups that pass two different
 *     URIs get two managers (and thus two connection pools), instead of
 *     silently reusing the first one;
 *   - BaseBot's IoC container and the legacy `dbConnect()` callers share
 *     the same manager instance per URI — no double pool.
 */
const managers = new Map<string, MongoConnectionManager>();

/**
 * Return the process-wide {@link MongoConnectionManager} for `mongoURI`,
 * creating one on first request. Both `dbConnect()` (legacy callers) and
 * `BaseBot`'s IoC container go through this so a guild's connection is
 * cached exactly once regardless of which path opens it first.
 */
export const getMongoConnectionManagerForUri = (mongoURI: string): MongoConnectionManager => {
  const existing = managers.get(mongoURI);
  if (existing !== undefined) return existing;
  const created = new MongoConnectionManager(mongoURI);
  managers.set(mongoURI, created);
  return created;
};

/**
 * Legacy connection factory. Equivalent to:
 *   `containerForBot.resolve(TOKENS.ConnectionManager).getConnection(asGuildId(id))`
 */
export const dbConnect = async (mongoURI: string, guild_id: string): Promise<GuildDb> => {
  const guildId: GuildId = asGuildId(guild_id);
  const m = getMongoConnectionManagerForUri(mongoURI);
  const guildConn = await m.getConnection(guildId);
  return { connection: guildConn.connection, models: guildConn.models };
};

const db = { dbConnect };
export default db;

export { buildGuildMongoUri };

export type { Models } from '../infra/mongo';
export type {
  FetchDoc,
  MessageDoc,
  ReplyDoc,
  TodoDoc,
  GiveawayDoc,
  ActivityDoc,
  UserApiSettingDoc,
  DocByName,
  SchemaName,
} from '../persistence/schemas';
export { SCHEMAS } from '../persistence/schemas';
