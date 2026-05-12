/**
 * Per-guild MongoDB connection lifecycle.
 *
 * Owns the SDK boundary to mongoose: opening, closing, and tracking
 * one `Connection` per guild id. Repositories receive a `Connection`
 * (via {@link ConnectionManager.getConnection}) and never touch
 * `mongoose.createConnection` themselves — that keeps `persistence/`
 * free of SDK lifecycle concerns and makes test substitution trivial.
 *
 * Why `infra/mongo/` and not `persistence/`:
 *   `persistence/` owns the mapping from domain to storage (schemas +
 *   repositories). Connection acquisition is the SDK boundary, the same
 *   category as a Discord client or LLM HTTP client. Per the layer
 *   contract (plan §1, layer rules, and architecture-reviewer consult).
 */
import mongoose, { type Connection, type Model } from 'mongoose';
import type { GuildId } from '../../core/ids';
import { SCHEMAS, type DocByName, type SchemaName } from '../../persistence/schemas';

/**
 * Typed model registry for one guild connection. Replaces the legacy
 * `Record<string, Model<any>>` map.
 */
export type Models = {
  readonly [K in SchemaName]: Model<DocByName[K]>;
};

export interface GuildConnection {
  readonly guildId: GuildId;
  readonly connection: Connection;
  readonly models: Models;
}

/**
 * Validate and assemble a per-guild MongoDB URI.
 *
 * Discord snowflake ids are digit-only; rejecting anything else here
 * prevents URI injection via crafted guild ids (e.g. a `guildId` that
 * embeds `?` would silently rewrite the connection's query string).
 */
export const buildGuildMongoUri = (baseUri: string, guildId: string): string => {
  if (guildId.length === 0) {
    throw new TypeError('buildGuildMongoUri: guildId must be non-empty');
  }
  if (!/^\d+$/.test(guildId)) {
    throw new TypeError(`buildGuildMongoUri: guildId must be all digits, got "${guildId}"`);
  }
  return `${baseUri}${guildId}?authSource=admin`;
};

const buildModels = (connection: Connection): Models => ({
  Fetch: connection.model<DocByName['Fetch']>('Fetch', SCHEMAS.Fetch),
  Message: connection.model<DocByName['Message']>('Message', SCHEMAS.Message),
  Reply: connection.model<DocByName['Reply']>('Reply', SCHEMAS.Reply),
  Todo: connection.model<DocByName['Todo']>('Todo', SCHEMAS.Todo),
  Giveaway: connection.model<DocByName['Giveaway']>('Giveaway', SCHEMAS.Giveaway),
  Activity: connection.model<DocByName['Activity']>('Activity', SCHEMAS.Activity),
  UserApiSetting: connection.model<DocByName['UserApiSetting']>(
    'UserApiSetting',
    SCHEMAS.UserApiSetting,
  ),
});

/**
 * Connection acquisition contract. Implementations:
 *   - {@link MongoConnectionManager}: production, talks to a real cluster.
 *   - tests can swap in a manager backed by mongodb-memory-server
 *     without changing repository code.
 */
export interface ConnectionManager {
  /**
   * Open (or return the cached) connection for `guildId`. The returned
   * `GuildConnection` carries the strongly-typed `Models` map.
   */
  getConnection(guildId: GuildId): Promise<GuildConnection>;
  /** Close every open guild connection. Safe to call multiple times. */
  closeAll(): Promise<void>;
  /** Close a single guild connection if open; no-op otherwise. */
  close(guildId: GuildId): Promise<void>;
}

/**
 * Default {@link ConnectionManager} backed by `mongoose.createConnection`.
 *
 * Connections are cached per guild id; concurrent `getConnection` calls
 * for the same guild dedupe via the in-flight promise so the cluster is
 * not hit twice during a startup race.
 */
export class MongoConnectionManager implements ConnectionManager {
  private readonly cache = new Map<GuildId, GuildConnection>();
  private readonly pending = new Map<GuildId, Promise<GuildConnection>>();

  constructor(private readonly baseUri: string) {}

  public async getConnection(guildId: GuildId): Promise<GuildConnection> {
    const cached = this.cache.get(guildId);
    if (cached !== undefined) return cached;

    const inFlight = this.pending.get(guildId);
    if (inFlight !== undefined) return inFlight;

    const promise = this.open(guildId).finally(() => {
      this.pending.delete(guildId);
    });
    this.pending.set(guildId, promise);
    return promise;
  }

  public async close(guildId: GuildId): Promise<void> {
    const entry = this.cache.get(guildId);
    if (entry === undefined) return;
    this.cache.delete(guildId);
    await entry.connection.close();
  }

  public async closeAll(): Promise<void> {
    const entries = [...this.cache.values()];
    this.cache.clear();
    await Promise.all(entries.map((e) => e.connection.close()));
  }

  private async open(guildId: GuildId): Promise<GuildConnection> {
    const uri = buildGuildMongoUri(this.baseUri, guildId);
    const connection = await mongoose.createConnection(uri).asPromise();
    const models = buildModels(connection);
    // Block until declared indexes (e.g. unique `Message.messageId`)
    // are present. Otherwise the very first `insertManyIgnoringDuplicates`
    // after a cold-start `getConnection` can race the auto-index build
    // and silently store duplicate rows.
    await Promise.all(Object.values(models).map((m) => m.init()));
    const entry: GuildConnection = { guildId, connection, models };
    this.cache.set(guildId, entry);
    return entry;
  }
}

/**
 * Adapter that wraps an externally-managed `Connection` (typically the
 * mongodb-memory-server in integration tests). Lets tests reuse the same
 * `ConnectionManager` contract without spinning per-guild URIs.
 */
export class StaticConnectionManager implements ConnectionManager {
  private readonly cache = new Map<GuildId, GuildConnection>();

  constructor(private readonly underlying: Connection) {}

  public async getConnection(guildId: GuildId): Promise<GuildConnection> {
    const cached = this.cache.get(guildId);
    if (cached !== undefined) return cached;
    const models = buildModels(this.underlying);
    // Block until every model's declared indexes (notably the unique
    // index on Message.messageId that insertManyIgnoringDuplicates
    // depends on) are present. Without this, the first insert of a
    // suite races the auto-index build and unique constraints silently
    // do not enforce. Cheap in tests; production uses
    // MongoConnectionManager whose underlying connection is already
    // long-lived by the time repos are touched.
    await Promise.all(Object.values(models).map((m) => m.init()));
    const entry: GuildConnection = {
      guildId,
      connection: this.underlying,
      models,
    };
    this.cache.set(guildId, entry);
    return entry;
  }

  public async close(guildId: GuildId): Promise<void> {
    this.cache.delete(guildId);
  }

  public async closeAll(): Promise<void> {
    this.cache.clear();
  }
}
