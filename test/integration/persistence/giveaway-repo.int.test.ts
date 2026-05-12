import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { StaticConnectionManager } from '../../../src/infra/mongo/connection-manager';
import {
  MongoGiveawayRepo,
  type GiveawayInput,
} from '../../../src/persistence/repositories/giveaway.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');
const buildRepo = async (m: StaticConnectionManager): Promise<MongoGiveawayRepo> =>
  new MongoGiveawayRepo(await m.getConnection(guildId));

const input = (overrides: Partial<GiveawayInput> & { message_id: string }): GiveawayInput => ({
  winner_num: 1,
  prize: 'mug',
  end_time: Date.now() + 60_000,
  channel_id: 'c1',
  prize_owner_id: 'u1',
  participants: [],
  ...overrides,
});

describe('MongoGiveawayRepo (integration)', () => {
  it('create persists and findByMessageId returns the same doc', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create(input({ message_id: 'm1' }));
      expect((await repo.findByMessageId('m1'))?.prize).toBe('mug');
    });
  });

  it('findByMessageId returns undefined for an unknown message id', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.findByMessageId('missing')).toBeUndefined();
    });
  });

  it('listAll returns every giveaway (used by reboot job)', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create(input({ message_id: 'm1' }));
      await repo.create(input({ message_id: 'm2', prize: 'hat' }));
      const all = await repo.listAll();
      expect(all.map((d) => d.message_id).sort()).toEqual(['m1', 'm2']);
    });
  });

  it('deleteByMessageId removes and returns true / false correctly', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create(input({ message_id: 'm1' }));
      expect(await repo.deleteByMessageId('m1')).toBe(true);
      expect(await repo.deleteByMessageId('m1')).toBe(false);
    });
  });
});
