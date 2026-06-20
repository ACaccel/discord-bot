/**
 * Integration regression for the `Result<T, DatabaseError>`
 * boundary on `MongoMessageRepo`.
 *
 * The unit tests in `test/unit/persistence/error-translator.test.ts`
 * cover the classifier with synthetic shapes; this suite drives a
 * real mongoose call against the shared memory-server so both the
 * `err(DatabaseError)` path (closed connection) and the
 * BulkWriteError-with-`insertedDocs` happy path are exercised exactly
 * as production would experience them.
 */
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { DatabaseError } from '../../../src/core/errors';
import { asGuildId } from '../../../src/core/ids';
import { isErr, isOk } from '../../../src/core/result';
import {
  StaticConnectionManager,
  buildGuildMongoUri,
} from '../../../src/infra/mongo/connection-manager';
import { MongoMessageRepo } from '../../../src/persistence/repositories/message.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');

describe('MongoMessageRepo error boundary (integration)', () => {
  it('countAll resolves to err(DatabaseError) on a closed-connection failure', async () => {
    const baseUri = (() => {
      const uri = process.env.INTEGRATION_MONGO_URI;
      if (uri === undefined) throw new Error('INTEGRATION_MONGO_URI not set');
      return uri.replace(/[^/]*$/, '');
    })();
    // Use a fresh dedicated connection, then close it to trigger the
    // mongoose "ClientClosed" / network error path for countAll().
    const connection = await mongoose
      .createConnection(buildGuildMongoUri(baseUri, guildId))
      .asPromise();
    const repo = new MongoMessageRepo(
      await new StaticConnectionManager(connection).getConnection(guildId),
    );
    await connection.close();

    const result = await repo.countAll();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(DatabaseError);
      expect(result.error.kind).toBe('DatabaseError');
      expect(result.error.context.operation).toBe('MongoMessageRepo.countAll');
      expect(result.error.cause).toBeDefined();
    }
  });

  it('insertManyIgnoringDuplicates resolves to ok with partial counts on duplicate-key (NOT err)', async () => {
    await withFreshConnection(async (connection) => {
      const repo = new MongoMessageRepo(
        await new StaticConnectionManager(connection).getConnection(guildId),
      );
      const buildDoc = (
        messageId: string,
      ): Parameters<typeof repo.insertManyIgnoringDuplicates>[0][number] =>
        ({
          channelId: 'c',
          channelName: 'general',
          content: 'x',
          messageId,
          userId: 'u',
          userName: 'n',
          timestamp: Date.now(),
          attachments: [],
          reactions: [],
          stickers: [],
          // Cast through `unknown` because mongoose 8 infers
          // DocumentArray<...> for nested arrays even though the lean
          // shape we want is a plain array — the cast is unsafe by
          // design and confined here.
        }) as unknown as Parameters<typeof repo.insertManyIgnoringDuplicates>[0][number];

      // First insert seeds m1.
      await repo.insertManyIgnoringDuplicates([buildDoc('m1')]);
      // Second batch collides on m1; the contract is "ok with partial
      // success counts, NOT an err(DatabaseError)" because duplicate-
      // ignoring is the documented behaviour of this method.
      const result = await repo.insertManyIgnoringDuplicates([
        buildDoc('m1'),
        buildDoc('m2'),
        buildDoc('m3'),
      ]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.inserted).toBe(2);
        expect(result.value.duplicates).toBe(1);
      }
    });
  });
});
