/**
 * Mongoose connection helpers for integration suites.
 *
 * Each test should call `withFreshConnection(async (conn) => { ... })`
 * — the helper opens a fresh mongoose connection against the
 * memory-server, runs the body, drops the database, and closes the
 * connection. This guarantees test isolation without the cost of
 * restarting the memory-server between cases.
 */
import mongoose, { type Connection } from 'mongoose';

const requireMongoUri = (): string => {
  const uri = process.env.INTEGRATION_MONGO_URI;
  if (uri === undefined || uri.length === 0) {
    throw new Error(
      'Integration helper: INTEGRATION_MONGO_URI is not set. ' +
        'Did vitest globalSetup at test/integration/setup.ts run?',
    );
  }
  return uri;
};

export const withFreshConnection = async <T>(
  body: (connection: Connection) => Promise<T>,
): Promise<T> => {
  const connection = await mongoose.createConnection(requireMongoUri()).asPromise();
  try {
    return await body(connection);
  } finally {
    await connection.dropDatabase();
    await connection.close();
  }
};
