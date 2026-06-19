import { describe, expect, it } from 'vitest';

import {
  ROLL_CALL_MAX_TARGETS,
  parseRollCallMentions,
  resolveRollCallTargets,
  type MemberLike,
  type MemberSource,
} from '../../../../src/handlers/commands/roll_call/resolve-targets';
import {
  rollCallOutcomeReply,
  type RollCallFailure,
} from '../../../../src/handlers/commands/roll_call/outcome-reply';

/** Minimal member stub; the resolver only reads `id`. */
const member = (id: string): MemberLike => ({ id });

const userMention = (id: string): string => `<@${id}>`;
const roleMention = (id: string): string => `<@&${id}>`;

interface SourceFixture {
  readonly guildId?: string;
  readonly users?: Record<string, MemberLike>;
  /** roleId -> members (already bot-filtered & ordered, as the handler does). */
  readonly roles?: Record<string, MemberLike[]>;
}

const makeSource = (fixture: SourceFixture): MemberSource<MemberLike> => {
  const roles = fixture.roles ?? {};
  return {
    guildId: fixture.guildId ?? '999',
    getMember: (userId) => fixture.users?.[userId],
    roleExists: (roleId) => Object.prototype.hasOwnProperty.call(roles, roleId),
    membersOfRole: (roleId) => roles[roleId] ?? [],
  };
};

const ids = (members: readonly MemberLike[]): string[] => members.map((m) => m.id);

describe('parseRollCallMentions', () => {
  it('returns null for free-form text with no mentions', () => {
    expect(parseRollCallMentions('hello world')).toBeNull();
    expect(parseRollCallMentions('')).toBeNull();
    expect(parseRollCallMentions('@someone')).toBeNull();
  });

  it('parses a single user mention', () => {
    expect(parseRollCallMentions('<@123>')).toEqual({ userIds: ['123'], roleIds: [] });
  });

  it('treats the <@!id> nickname form as a user mention', () => {
    expect(parseRollCallMentions('<@!123>')).toEqual({ userIds: ['123'], roleIds: [] });
  });

  it('parses a single role mention', () => {
    expect(parseRollCallMentions('<@&456>')).toEqual({ userIds: [], roleIds: ['456'] });
  });

  it('splits mixed user and role mentions and preserves first-seen order', () => {
    expect(parseRollCallMentions('<@1>   <@&2>\t<@3>')).toEqual({
      userIds: ['1', '3'],
      roleIds: ['2'],
    });
  });

  it('de-duplicates repeated user and role IDs within each kind', () => {
    expect(parseRollCallMentions('<@1> <@1> <@&2> <@&2>')).toEqual({
      userIds: ['1'],
      roleIds: ['2'],
    });
  });
});

describe('resolveRollCallTargets', () => {
  const baseFixture: SourceFixture = {
    guildId: '999',
    users: { '1': member('1'), '2': member('2') },
    roles: {
      '10': [member('3'), member('4')],
      '20': [member('2'), member('5')],
      '40': [member('4'), member('6')],
      '30': [],
    },
  };

  it('rejects malformed input with format_error', () => {
    const outcome = resolveRollCallTargets(
      'nonsense',
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome.status).toBe('format_error');
  });

  it('resolves direct user mentions in typed order', () => {
    const outcome = resolveRollCallTargets(
      `${userMention('1')} ${userMention('2')}`,
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(ids(outcome.members)).toEqual(['1', '2']);
  });

  it('expands a role to its members', () => {
    const outcome = resolveRollCallTargets(
      roleMention('10'),
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(ids(outcome.members)).toEqual(['3', '4']);
  });

  it('blocks @everyone (role id equal to the guild id)', () => {
    const outcome = resolveRollCallTargets(
      roleMention('999'),
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome.status).toBe('everyone_not_allowed');
  });

  it('reports user_not_found with the offending id', () => {
    const outcome = resolveRollCallTargets(
      `${userMention('1')} ${userMention('7')}`,
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome).toEqual({ status: 'user_not_found', id: '7' });
  });

  it('reports role_no_members for a non-existent role', () => {
    const outcome = resolveRollCallTargets(
      roleMention('77'),
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome).toEqual({ status: 'role_no_members', id: '77' });
  });

  it('reports role_no_members for a role with no callable members', () => {
    const outcome = resolveRollCallTargets(
      roleMention('30'),
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome).toEqual({ status: 'role_no_members', id: '30' });
  });

  it('de-duplicates a member referenced both directly and via a role', () => {
    const outcome = resolveRollCallTargets(
      `${userMention('2')} ${roleMention('20')}`,
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(ids(outcome.members)).toEqual(['2', '5']);
  });

  it('de-duplicates a member shared across two roles', () => {
    const outcome = resolveRollCallTargets(
      `${roleMention('10')} ${roleMention('40')}`,
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(ids(outcome.members)).toEqual(['3', '4', '6']);
  });

  it('merges users and roles under the cap', () => {
    const outcome = resolveRollCallTargets(
      `${userMention('1')} ${roleMention('10')}`,
      makeSource(baseFixture),
      ROLL_CALL_MAX_TARGETS,
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(ids(outcome.members)).toEqual(['1', '3', '4']);
  });

  it('accepts a final count exactly at the cap', () => {
    const outcome = resolveRollCallTargets(roleMention('10'), makeSource(baseFixture), 2);
    expect(outcome.status).toBe('ok');
  });

  it('rejects a final count over the cap with too_many', () => {
    const outcome = resolveRollCallTargets(roleMention('10'), makeSource(baseFixture), 1);
    expect(outcome).toEqual({ status: 'too_many', count: 2, max: 1 });
  });

  it('prefers a specific failure over the size cap', () => {
    // '7' is unknown; even though the role would also blow a cap of 1, the
    // specific user_not_found must win.
    const outcome = resolveRollCallTargets(
      `${userMention('7')} ${roleMention('10')}`,
      makeSource(baseFixture),
      1,
    );
    expect(outcome).toEqual({ status: 'user_not_found', id: '7' });
  });
});

describe('rollCallOutcomeReply', () => {
  const cases: ReadonlyArray<{
    outcome: RollCallFailure;
    key: string;
    params?: Record<string, string | number>;
  }> = [
    { outcome: { status: 'format_error' }, key: 'replies:roll_call.format_error' },
    { outcome: { status: 'everyone_not_allowed' }, key: 'replies:roll_call.everyone_not_allowed' },
    {
      outcome: { status: 'user_not_found', id: '7' },
      key: 'replies:roll_call.user_not_found',
      params: { id: '7' },
    },
    {
      outcome: { status: 'role_no_members', id: '9' },
      key: 'replies:roll_call.role_no_members',
      params: { id: '9' },
    },
    { outcome: { status: 'empty' }, key: 'replies:roll_call.no_valid_id' },
    {
      outcome: { status: 'too_many', count: 60, max: 50 },
      key: 'replies:roll_call.too_many_targets',
      params: { count: 60, max: 50 },
    },
  ];

  it.each(cases)('maps $outcome.status to its translator key', ({ outcome, key, params }) => {
    expect(rollCallOutcomeReply(outcome)).toEqual(params ? { key, params } : { key });
  });
});
