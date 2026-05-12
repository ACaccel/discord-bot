import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { StaticConnectionManager } from '../../../src/infra/mongo/connection-manager';
import {
  MongoUserApiSettingRepo,
  type UserApiSettingDefaults,
} from '../../../src/persistence/repositories/user-api-setting.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');
const buildRepo = async (m: StaticConnectionManager): Promise<MongoUserApiSettingRepo> =>
  new MongoUserApiSettingRepo(await m.getConnection(guildId));

const defaults: UserApiSettingDefaults = {
  provider: 'openai',
  model: 'gpt-4o',
  temperature: 1,
  system_prompt: '',
  web_search: false,
};

describe('MongoUserApiSettingRepo (integration)', () => {
  it('findByUserId returns undefined when not whitelisted', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.findByUserId('u1')).toBeUndefined();
    });
  });

  it('create whitelists a user with default settings', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      const created = await repo.create('u1', defaults);
      expect(created.userId).toBe('u1');
      expect(created.provider).toBe('openai');
      expect((await repo.findByUserId('u1'))?.model).toBe('gpt-4o');
    });
  });

  it('listAll returns every whitelist entry', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create('u1', defaults);
      await repo.create('u2', defaults);
      expect((await repo.listAll()).map((d) => d.userId).sort()).toEqual(['u1', 'u2']);
    });
  });

  it('update applies a partial patch and returns true on match', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create('u1', defaults);
      expect(await repo.update('u1', { model: 'gpt-5', temperature: 0.3 })).toBe(true);
      const after = await repo.findByUserId('u1');
      expect(after?.model).toBe('gpt-5');
      expect(after?.temperature).toBe(0.3);
      expect(after?.provider).toBe('openai'); // unchanged
    });
  });

  it('update returns false when the user is not whitelisted', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.update('missing', { model: 'gpt-5' })).toBe(false);
    });
  });

  it('deleteByUserId removes the entry and returns true / false correctly', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create('u1', defaults);
      expect(await repo.deleteByUserId('u1')).toBe(true);
      expect(await repo.deleteByUserId('u1')).toBe(false);
    });
  });
});
