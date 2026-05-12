import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { StaticConnectionManager } from '../../../src/infra/mongo/connection-manager';
import {
  MongoActivityRepo,
  type ActivityInput,
} from '../../../src/persistence/repositories/activity.repo';
import { withFreshConnection } from '../helpers/mongo';

const guildId = asGuildId('999999999999999999');
const buildRepo = async (m: StaticConnectionManager): Promise<MongoActivityRepo> =>
  new MongoActivityRepo(await m.getConnection(guildId));

const input = (overrides: Partial<ActivityInput> & { activity_id: string }): ActivityInput => ({
  message_id: 'mid',
  title: 'meet',
  description: '',
  expired_at: Date.now() + 60_000,
  channel_id: 'c1',
  participants: [],
  ...overrides,
});

describe('MongoActivityRepo (integration)', () => {
  it('create persists and findByActivityId returns it', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create(input({ activity_id: 'a1', title: 'standup' }));
      expect((await repo.findByActivityId('a1'))?.title).toBe('standup');
    });
  });

  it('findByActivityId returns undefined when absent', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.findByActivityId('missing')).toBeUndefined();
    });
  });

  it('listAll returns every activity (used by reboot job)', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create(input({ activity_id: 'a1' }));
      await repo.create(input({ activity_id: 'a2' }));
      expect((await repo.listAll()).map((d) => d.activity_id).sort()).toEqual(['a1', 'a2']);
    });
  });

  it('setParticipants updates the list and returns true on match', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create(input({ activity_id: 'a1' }));
      expect(await repo.setParticipants('a1', ['u1', 'u2'])).toBe(true);
      expect((await repo.findByActivityId('a1'))?.participants).toEqual(['u1', 'u2']);
    });
  });

  it('setParticipants returns false when the activity is absent', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(await repo.setParticipants('missing', ['u1'])).toBe(false);
    });
  });

  it('deleteByActivityId removes and returns true / false correctly', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      await repo.create(input({ activity_id: 'a1' }));
      expect(await repo.deleteByActivityId('a1')).toBe(true);
      expect(await repo.deleteByActivityId('a1')).toBe(false);
    });
  });
});
