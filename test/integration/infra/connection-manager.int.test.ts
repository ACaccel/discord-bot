/**
 * Integration smoke for `MongoConnectionManager`'s in-flight dedupe.
 *
 * The `pending` map exists to prevent two simultaneous
 * `getConnection(g)` calls from opening the cluster connection twice.
 * Asserting that here closes the only `MongoConnectionManager` code
 * path the message-repo suite does not exercise (it uses
 * `StaticConnectionManager`).
 */
import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { MongoConnectionManager } from '../../../src/infra/mongo/connection-manager';

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
});
