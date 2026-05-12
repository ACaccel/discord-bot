/**
 * Integration regression for the Phase-3 DatabaseError wrapping
 * contract on `MongoMessageRepo`.
 *
 * The unit tests in `test/unit/infra/mongo/error-translator.test.ts`
 * cover the classifier with synthetic shapes; this suite drives a
 * real mongoose call against the shared memory-server so the actual
 * BulkWriteError-with-no-`insertedDocs`-shape branch is exercised
 * exactly as production would experience it.
 */
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { DatabaseError } from '../../../src/core/errors';
import { asGuildId } from '../../../src/core/ids';
import {
  StaticConnectionManager,
  buildGuildMongoUri,
} from '../../../src/infra/mongo/connection-manager';
import { MongoMessageRepo } from '../../../src/persistence/repositories/message.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');

describe('MongoMessageRepo error wrapping (integration)', () => {
  it('countAll wraps a closed-connection failure as DatabaseError', async () => {
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

    await expect(repo.countAll()).rejects.toBeInstanceOf(DatabaseError);
    try {
      await repo.countAll();
    } catch (e) {
      const err = e as DatabaseError;
      expect(err.kind).toBe('DatabaseError');
      expect(err.context.operation).toBe('MongoMessageRepo.countAll');
      expect(err.cause).toBeDefined();
    }
  });

  it('insertManyIgnoringDuplicates returns partial counts on duplicate-key (NOT thrown as DatabaseError)', async () => {
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
      // Second batch collides on m1; the contract is "partial success
      // counts returned, not a thrown DatabaseError" because duplicate-
      // ignoring is the documented behaviour of this method.
      const result = await repo.insertManyIgnoringDuplicates([
        buildDoc('m1'),
        buildDoc('m2'),
        buildDoc('m3'),
      ]);
      expect(result.inserted).toBe(2);
      expect(result.duplicates).toBe(1);
    });
  });
});
