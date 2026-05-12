/**
 * Integration smoke for `MongoConnectionManager`.
 *
 * Covers two production-side paths the message-repo suite does not
 * exercise (it uses `StaticConnectionManager`):
 *   - In-flight dedupe via the `pending` map (two simultaneous
 *     `getConnection(g)` calls share one open).
 *   - Cleanup on init failure: when `model.init()` rejects after the
 *     mongoose connection is already open, the connection must be
 *     closed before the rejection bubbles. Regression for a codex
 *     stop-hook finding ("Mongo connection setup leaks open
 *     connections on init failure").
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

  it('closes the underlying mongoose connection when model.init() rejects', async () => {
    // Trigger a real `model.init()` failure by pre-seeding two docs
    // that violate `Message.messageId`'s unique index. When the
    // manager later opens this guild's database, its `m.init()` call
    // will fail building the unique index — the regression target is
    // that the already-open mongoose connection must be closed
    // before the rejection bubbles, otherwise every retry leaks
    // another socket.
    const baseUri = requireMongoUri().replace(/[^/]*$/, '');
    const leakGuildId = asGuildId('333333333333333333');
    const seedUri = buildGuildMongoUri(baseUri, leakGuildId);

    const seed = await mongoose.createConnection(seedUri).asPromise();
    try {
      await seed.collection('messages').insertMany([
        { messageId: 'collide', timestamp: 1 },
        { messageId: 'collide', timestamp: 2 },
      ]);
    } finally {
      await seed.close();
    }

    const baselineOpen = mongoose.connections.filter((c) => c.readyState === 1).length;

    const mgr = new MongoConnectionManager(baseUri);
    await expect(mgr.getConnection(leakGuildId)).rejects.toThrow();

    // Manager owns no leaked connection: the post-failure count of
    // *connected* mongoose connections must match the pre-attempt
    // baseline. Pre-fix, this number would be baseline + 1.
    const afterOpen = mongoose.connections.filter((c) => c.readyState === 1).length;
    expect(afterOpen).toBe(baselineOpen);

    // Cleanup the seed data so a re-run of this suite stays clean.
    const cleanup = await mongoose.createConnection(seedUri).asPromise();
    try {
      await cleanup.dropDatabase();
    } finally {
      await cleanup.close();
    }
  });
});
