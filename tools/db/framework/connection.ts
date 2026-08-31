/**
 * Per-guild MongoDB connection helper for the ops CLI.
 *
 * Standardizes every command on the production `buildGuildMongoUri`
 * (`src/infra/mongo/connection-manager.ts`) — the same URI builder the
 * bots use — instead of the per-tool copies the standalone tools used to
 * carry. It opens a one-shot mongoose connection scoped to a guild's
 * database, runs the caller's `fn`, and always closes the connection in a
 * `finally`, so callers never leak a handle on an error path.
 *
 * These are one-shot maintenance ops, so a direct `createConnection` is
 * the right primitive: the resilient, cached `MongoConnectionManager` is
 * for long-lived per-bot runtimes, not single-pass scripts.
 */
import mongoose, { type Connection } from 'mongoose';

import { buildGuildMongoUri } from '../../../src/infra/mongo/connection-manager';

/**
 * Open a connection to one guild's database, invoke `fn` with it, and
 * close it afterwards regardless of outcome. `baseUri` must be the
 * normalized host-with-trailing-slash form produced by `loadConfig`.
 */
export const withGuildConnection = async <R>(
  baseUri: string,
  guildId: string,
  fn: (connection: Connection) => Promise<R>,
): Promise<R> => {
  const uri = buildGuildMongoUri(baseUri, guildId);
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    return await fn(connection);
  } finally {
    await connection.close();
  }
};
