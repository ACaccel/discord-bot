import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { DatabaseError } from '../../../src/core/errors';
import { isErr, unwrap } from '../../../src/core/result';
import {
  StaticConnectionManager,
  buildGuildMongoUri,
} from '../../../src/infra/mongo/connection-manager';
import { MongoTodoRepo } from '../../../src/persistence/repositories/todo.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');
const buildRepo = async (m: StaticConnectionManager): Promise<MongoTodoRepo> =>
  new MongoTodoRepo(await m.getConnection(guildId));

describe('MongoTodoRepo (integration)', () => {
  it('create persists a todo and listAll returns it', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.create('buy milk'));
      const all = unwrap(await repo.listAll());
      expect(all.map((d) => d.content)).toEqual(['buy milk']);
    });
  });

  it('findByContent returns matching entries (legacy dedupe path)', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.create('buy milk'));
      unwrap(await repo.create('buy milk')); // legacy schema is not unique
      const dupes = unwrap(await repo.findByContent('buy milk'));
      expect(dupes).toHaveLength(2);
    });
  });

  it('deleteByContent removes the first match and returns true', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.create('buy milk'));
      expect(unwrap(await repo.deleteByContent('buy milk'))).toBe(true);
      expect(unwrap(await repo.listAll())).toHaveLength(0);
    });
  });

  it('deleteByContent returns false when nothing matches', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.deleteByContent('does not exist'))).toBe(false);
    });
  });

  // G-2: a genuine DB failure resolves to `err(DatabaseError)`.
  it('listAll resolves to err(DatabaseError) when the connection is closed', async () => {
    const baseUri = (() => {
      const uri = process.env.INTEGRATION_MONGO_URI;
      if (uri === undefined) throw new Error('INTEGRATION_MONGO_URI not set');
      return uri.replace(/[^/]*$/, '');
    })();
    const connection = await mongoose
      .createConnection(buildGuildMongoUri(baseUri, guildId))
      .asPromise();
    const repo = new MongoTodoRepo(
      await new StaticConnectionManager(connection).getConnection(guildId),
    );
    await connection.close();

    const result = await repo.listAll();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(DatabaseError);
      expect(result.error.context.operation).toBe('MongoTodoRepo.listAll');
    }
  });
});
