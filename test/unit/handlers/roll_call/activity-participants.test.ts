/**
 * Unit coverage for the `/roll_call activity_id:` claim step. The
 * load-bearing behaviours are the ordering (participants resolved and
 * checked BEFORE the activity is consumed) and the TOCTOU outcome: a
 * lost delete race must report `already_consumed` so the second caller
 * never re-posts the announcement.
 */
import type { Guild, GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import {
  activityParticipantsReply,
  claimActivityParticipants,
} from '../../../../src/handlers/commands/roll_call/activity-participants';
import { ok } from '../../../../src/core/result';
import { databaseErrorFrom } from '../../../../src/persistence/error-translator';
import type { Repos } from '../../../../src/persistence/repositories';

const ACTIVITY_ID = 'act-1';

const guildWithMembers = (ids: readonly string[]): Guild =>
  ({
    id: 'g1',
    members: {
      cache: {
        get: (id: string) =>
          ids.includes(id) ? ({ id, displayName: id } as unknown as GuildMember) : undefined,
      },
    },
  }) as unknown as Guild;

const reposWith = (options: {
  participants?: readonly string[] | undefined;
  deleted?: boolean;
}): Pick<Repos, 'activity'> =>
  ({
    activity: {
      findByActivityId: vi.fn(async () =>
        ok(
          options.participants === undefined
            ? undefined
            : { activity_id: ACTIVITY_ID, participants: options.participants },
        ),
      ),
      deleteByActivityId: vi.fn(async () => ok(options.deleted ?? true)),
    },
  }) as unknown as Pick<Repos, 'activity'>;

describe('claimActivityParticipants', () => {
  it('resolves the cached members and consumes the activity', async () => {
    const repos = reposWith({ participants: ['u1', 'u2'] });

    const outcome = await claimActivityParticipants(
      guildWithMembers(['u1', 'u2']),
      repos,
      ACTIVITY_ID,
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.members.map((m) => m.id)).toEqual(['u1', 'u2']);
    expect(repos.activity.deleteByActivityId).toHaveBeenCalledWith(ACTIVITY_ID);
  });

  it('skips participants who are no longer in the guild', async () => {
    const outcome = await claimActivityParticipants(
      guildWithMembers(['u1']),
      reposWith({ participants: ['u1', 'gone'] }),
      ACTIVITY_ID,
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.members.map((m) => m.id)).toEqual(['u1']);
  });

  it('reports no_guild outside a guild, without touching the database', async () => {
    const repos = reposWith({ participants: ['u1'] });

    expect(await claimActivityParticipants(null, repos, ACTIVITY_ID)).toEqual({
      status: 'no_guild',
    });
    expect(repos.activity.findByActivityId).not.toHaveBeenCalled();
  });

  it('reports no_db when the guild has no repos bag', async () => {
    expect(await claimActivityParticipants(guildWithMembers([]), undefined, ACTIVITY_ID)).toEqual({
      status: 'no_db',
    });
  });

  it('reports activity_not_found for an unknown id', async () => {
    const outcome = await claimActivityParticipants(
      guildWithMembers(['u1']),
      reposWith({ participants: undefined }),
      ACTIVITY_ID,
    );
    expect(outcome).toEqual({ status: 'activity_not_found' });
  });

  it('leaves the activity intact when none of its participants remain', async () => {
    const repos = reposWith({ participants: ['gone'] });

    expect(await claimActivityParticipants(guildWithMembers([]), repos, ACTIVITY_ID)).toEqual({
      status: 'no_participants',
    });
    // The activity survives a roll call that could not reach anyone.
    expect(repos.activity.deleteByActivityId).not.toHaveBeenCalled();
  });

  it('reports already_consumed when a concurrent call won the delete race', async () => {
    const outcome = await claimActivityParticipants(
      guildWithMembers(['u1']),
      reposWith({ participants: ['u1'], deleted: false }),
      ACTIVITY_ID,
    );
    expect(outcome).toEqual({ status: 'already_consumed' });
  });

  it('re-throws a lookup error to the handler error boundary', async () => {
    const boom = databaseErrorFrom(new Error('mongo down'), {
      operation: 'ActivityRepo.findByActivityId',
    });
    const repos = {
      activity: { findByActivityId: vi.fn(async () => ({ ok: false, error: boom }) as never) },
    } as unknown as Pick<Repos, 'activity'>;

    await expect(
      claimActivityParticipants(guildWithMembers(['u1']), repos, ACTIVITY_ID),
    ).rejects.toBe(boom);
  });

  it('re-throws a delete error rather than announcing an unconsumed activity', async () => {
    const boom = databaseErrorFrom(new Error('mongo down'), {
      operation: 'ActivityRepo.deleteByActivityId',
    });
    const repos = {
      activity: {
        findByActivityId: vi.fn(async () => ok({ activity_id: ACTIVITY_ID, participants: ['u1'] })),
        deleteByActivityId: vi.fn(async () => ({ ok: false, error: boom }) as never),
      },
    } as unknown as Pick<Repos, 'activity'>;

    await expect(
      claimActivityParticipants(guildWithMembers(['u1']), repos, ACTIVITY_ID),
    ).rejects.toBe(boom);
  });
});

describe('activityParticipantsReply', () => {
  it('maps every rejection to a catalog key', () => {
    expect(activityParticipantsReply({ status: 'no_guild' }, ACTIVITY_ID).key).toBe(
      'errors:command.guild_not_found',
    );
    expect(activityParticipantsReply({ status: 'no_db' }, ACTIVITY_ID).key).toBe(
      'errors:db.not_found',
    );
    expect(activityParticipantsReply({ status: 'no_participants' }, ACTIVITY_ID).key).toBe(
      'replies:roll_call.no_participants',
    );
  });

  it('interpolates the activity id where the copy names it', () => {
    expect(activityParticipantsReply({ status: 'activity_not_found' }, ACTIVITY_ID)).toEqual({
      key: 'replies:roll_call.activity_not_found',
      params: { id: ACTIVITY_ID },
    });
    expect(activityParticipantsReply({ status: 'already_consumed' }, ACTIVITY_ID)).toEqual({
      key: 'replies:roll_call.activity_already_consumed',
      params: { id: ACTIVITY_ID },
    });
  });
});
