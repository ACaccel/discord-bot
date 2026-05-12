import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { StaticConnectionManager } from '../../../src/infra/mongo/connection-manager';
import { MongoTodoRepo } from '../../../src/persistence/repositories/todo.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');
const buildRepo = async (m: StaticConnectionManager): Promise<MongoTodoRepo> =>
  new MongoTodoRepo(await m.getConnection(guildId));

describe('MongoTodoRepo (integration)', () => {
  it('create persists a todo and listAll returns it', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create('buy milk');
      const all = await repo.listAll();
      expect(all.map((d) => d.content)).toEqual(['buy milk']);
    });
  });

  it('findByContent returns matching entries (legacy dedupe path)', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create('buy milk');
      await repo.create('buy milk'); // legacy schema is not unique
      const dupes = await repo.findByContent('buy milk');
      expect(dupes).toHaveLength(2);
    });
  });

  it('deleteByContent removes the first match and returns true', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create('buy milk');
      expect(await repo.deleteByContent('buy milk')).toBe(true);
      expect(await repo.listAll()).toHaveLength(0);
    });
  });

  it('deleteByContent returns false when nothing matches', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.deleteByContent('does not exist')).toBe(false);
    });
  });
});
