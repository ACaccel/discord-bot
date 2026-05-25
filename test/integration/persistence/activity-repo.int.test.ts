import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { asGuildId } from '../../../src/core/ids';
import { DatabaseError } from '../../../src/core/errors';
import { isErr, unwrap } from '../../../src/core/result';
import {
  StaticConnectionManager,
  buildGuildMongoUri,
} from '../../../src/infra/mongo/connection-manager';
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
      unwrap(await repo.create(input({ activity_id: 'a1', title: 'standup' })));
      expect(unwrap(await repo.findByActivityId('a1'))?.title).toBe('standup');
    });
  });

  it('findByActivityId returns ok(undefined) when absent', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.findByActivityId('missing'))).toBeUndefined();
    });
  });

  it('listAll returns every activity (used by reboot job)', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.create(input({ activity_id: 'a1' })));
      unwrap(await repo.create(input({ activity_id: 'a2' })));
      expect(
        unwrap(await repo.listAll())
          .map((d) => d.activity_id)
          .sort(),
      ).toEqual(['a1', 'a2']);
    });
  });

  it('setParticipants updates the list and returns true on match', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.create(input({ activity_id: 'a1' })));
      expect(unwrap(await repo.setParticipants('a1', ['u1', 'u2']))).toBe(true);
      expect(unwrap(await repo.findByActivityId('a1'))?.participants).toEqual(['u1', 'u2']);
    });
  });

  it('setParticipants returns false when the activity is absent', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      expect(unwrap(await repo.setParticipants('missing', ['u1']))).toBe(false);
    });
  });

  it('deleteByActivityId removes and returns true / false correctly', async () => {
    await withFreshConnection(async (connection) => {
      const repo = await buildRepo(new StaticConnectionManager(connection));
      unwrap(await repo.create(input({ activity_id: 'a1' })));
      expect(unwrap(await repo.deleteByActivityId('a1'))).toBe(true);
      expect(unwrap(await repo.deleteByActivityId('a1'))).toBe(false);
    });
  });

  // G-2: a genuine DB failure resolves to `err(DatabaseError)` rather
  // than throwing. Driving a closed-connection call exercises that
  // error channel exactly as production would experience it.
  it('listAll resolves to err(DatabaseError) when the connection is closed', async () => {
    const baseUri = (() => {
      const uri = process.env.INTEGRATION_MONGO_URI;
      if (uri === undefined) throw new Error('INTEGRATION_MONGO_URI not set');
      return uri.replace(/[^/]*$/, '');
    })();
    const connection = await mongoose
      .createConnection(buildGuildMongoUri(baseUri, guildId))
      .asPromise();
    const repo = new MongoActivityRepo(
      await new StaticConnectionManager(connection).getConnection(guildId),
    );
    await connection.close();

    const result = await repo.listAll();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(DatabaseError);
      expect(result.error.context.operation).toBe('MongoActivityRepo.listAll');
      expect(result.error.cause).toBeDefined();
    }
  });
});
