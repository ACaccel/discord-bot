/**
 * Integration smoke for `MongoConnectionManager`.
 *
 * Covers production-side paths the message-repo suite does not
 * exercise (it uses `StaticConnectionManager`):
 *   - In-flight dedupe via the `pending` map (two simultaneous
 *     `getConnection(g)` calls share one open).
 *   - Tolerance for `model.init()` failures: when an index build
 *     rejects (legacy duplicate data, missing `createIndex`
 *     permission, etc.) the manager logs the rejection but still
 *     returns a usable cached connection. Regression for the
 *     phase-7 hotfix that converted `Promise.all` -> `allSettled`
 *     after every DB command failed with "找不到資料庫" once a single
 *     model's init rejected.
 */
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import {
  MongoConnectionManager,
  buildGuildMongoUri,
} from '../../../src/infra/mongo/connection-manager';

const requireMongoUri = (): string => {
  const uri = process.env.INTEGRATION_MONGO_URI;
  if (uri === undefined) {
    throw new Error('INTEGRATION_MONGO_URI not set; vitest globalSetup did not run');
  }
  return uri;
};

const guildId = asGuildId('111111111111111111');

describe('MongoConnectionManager (integration)', () => {
  it('dedupes concurrent getConnection() calls for the same guild', async () => {
    // memory-server URIs already include a trailing slash + db name.
    // Reuse the URI directly; appending a guild id is the production
    // path and is exercised in the unit test for buildGuildMongoUri.
    const baseUri = requireMongoUri().replace(/[^/]*$/, '');
    const mgr = new MongoConnectionManager(baseUri);
    try {
      const [a, b, c] = await Promise.all([
        mgr.getConnection(guildId),
        mgr.getConnection(guildId),
        mgr.getConnection(guildId),
      ]);
      expect(a.connection).toBe(b.connection);
      expect(b.connection).toBe(c.connection);
    } finally {
      await mgr.closeAll();
    }
  });

  it('opens distinct connections for distinct guild ids', async () => {
    const baseUri = requireMongoUri().replace(/[^/]*$/, '');
    const mgr = new MongoConnectionManager(baseUri);
    try {
      const a = await mgr.getConnection(guildId);
      const b = await mgr.getConnection(asGuildId('222222222222222222'));
      expect(a.connection).not.toBe(b.connection);
    } finally {
      await mgr.closeAll();
    }
  });

  it('tolerates model.init() rejection and still returns a usable connection', async () => {
    // Trigger a real `model.init()` failure by pre-seeding two docs
    // that violate `Message.messageId`'s unique index. When the
    // manager later opens this guild's database, its `m.init()` call
    // for the `Message` model will fail building the unique index.
    //
    // The phase-7 contract: the manager logs the rejection to stderr
    // but still returns the (cached) `GuildConnection` so DB commands
    // for that guild keep working — operators fix the data / index
    // issue out-of-band; the bot does not block on it.
    const baseUri = requireMongoUri().replace(/[^/]*$/, '');
    const tolerateGuildId = asGuildId('333333333333333333');
    const seedUri = buildGuildMongoUri(baseUri, tolerateGuildId);

    const seed = await mongoose.createConnection(seedUri).asPromise();
    try {
      await seed.collection('messages').insertMany([
        { messageId: 'collide', timestamp: 1 },
        { messageId: 'collide', timestamp: 2 },
      ]);
    } finally {
      await seed.close();
    }

    // Silence the operator-facing stderr line during the test run; it
    // is intentional in production but noisy in vitest output.
    const stderrWrite = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;

    const mgr = new MongoConnectionManager(baseUri);
    try {
      const guildConn = await mgr.getConnection(tolerateGuildId);
      expect(guildConn.connection.readyState).toBe(1);
      // Models map is still wired even though the index for Message
      // is missing — repository code can still query/insert non-unique
      // workflows.
      expect(guildConn.models.Reply).toBeDefined();

      // Subsequent `getConnection` hits the cache and returns the same
      // entry (no re-attempt, no second stderr line).
      const reuse = await mgr.getConnection(tolerateGuildId);
      expect(reuse).toBe(guildConn);

      // Operator MUST see something about the init failure on stderr.
      expect(captured.some((line) => line.includes('model.init() failed'))).toBe(true);
    } finally {
      process.stderr.write = stderrWrite;
      await mgr.closeAll();
    }

    // Cleanup the seed data so a re-run of this suite stays clean.
    const cleanup = await mongoose.createConnection(seedUri).asPromise();
    try {
      await cleanup.dropDatabase();
    } finally {
      await cleanup.close();
    }
  });
});
