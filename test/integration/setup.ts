/**
 * Vitest global setup for the integration project.
 *
 * Owns the lifecycle of a single in-memory MongoDB instance shared by
 * every integration suite. The URI is published via the
 * `INTEGRATION_MONGO_URI` environment variable; helpers in
 * `test/integration/helpers/mongo.ts` consume it to build per-test
 * mongoose connections.
 *
 * Why one server, not one per suite:
 *   - Spinning a fresh `MongoMemoryServer` costs 1.5–4 seconds
 *     (binary download + bootstrap). Sharing across suites keeps the
 *     integration project under a few seconds end-to-end.
 *   - Per-test isolation is provided by `dropDatabase()` between cases
 *     in the helper layer, which is much cheaper than restart.
 *
 * Why `INTEGRATION_MONGO_URI` and not direct import:
 *   - vitest globalSetup runs in a separate worker scope; module-level
 *     state from this file is not visible to test files. An env var is
 *     the documented hand-off mechanism.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

let server: MongoMemoryServer | undefined;

export const setup = async (): Promise<void> => {
  server = await MongoMemoryServer.create();
  process.env.INTEGRATION_MONGO_URI = server.getUri();
};

export const teardown = async (): Promise<void> => {
  if (server !== undefined) {
    await server.stop({ doCleanup: true, force: true });
    server = undefined;
  }
  delete process.env.INTEGRATION_MONGO_URI;
};
