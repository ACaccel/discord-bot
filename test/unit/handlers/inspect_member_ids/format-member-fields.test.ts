import type { GuildMember, User } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  buildMemberDescription,
  type TFn,
} from '../../../../src/handlers/commands/inspect_member_ids/format-member-fields';

// Stub translator returns the key (plus a JSON-encoded params block when
// present) so tests can assert i18n keys without loading i18next.
const t: TFn = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe('buildMemberDescription', () => {
  it('renders a not-found description when both user and member are null', () => {
    const out = buildMemberDescription('12345', null, null, t);
    expect(out).toContain('**ID**: `12345`');
    expect(out).toContain('replies:inspect_member_ids.not_in_guild_line');
    expect(out).toContain('replies:inspect_member_ids.user_not_found_line');
  });

  it('renders user-only fields when the user is known but not in the guild', () => {
    const user = {
      id: '777',
      username: 'alice',
      globalName: 'Alice',
      tag: 'alice#0',
      bot: false,
      system: false,
      flags: { toArray: () => ['HypeSquadOnlineHouse1'] },
      accentColor: 0xff0000,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      displayAvatarURL: () => 'https://avatar',
      bannerURL: () => null,
    } as unknown as User;
    const out = buildMemberDescription('777', user, null, t);
    expect(out).toContain('**ID**: `777`');
    expect(out).toContain('**Username**: alice');
    expect(out).toContain('**Banner**: N/A');
    expect(out).toContain('replies:inspect_member_ids.joined_at_line');
    expect(out).toContain('N/A'); // member-only fields N/A
  });

  it('renders both user and member fields when both are present', () => {
    const guildId = 'g1';
    const member = {
      user: {
        id: '999',
        username: 'bob',
        globalName: 'Bob',
        tag: 'bob#0',
        bot: false,
        system: false,
        flags: { toArray: () => [] },
        accentColor: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        displayAvatarURL: () => 'https://avatar',
        bannerURL: () => 'https://banner',
      },
      guild: { id: guildId },
      roles: {
        cache: {
          filter: () => ({
            sort: () => ({
              first: () => [{ id: 'r1' }],
              size: 1,
            }),
          }),
        },
        highest: { id: 'r1' },
      },
      joinedAt: new Date('2024-02-01T00:00:00Z'),
      displayName: 'Bobby',
      isCommunicationDisabled: () => false,
      communicationDisabledUntil: null,
      pending: false,
      premiumSince: null,
      kickable: true,
      bannable: false,
    } as unknown as GuildMember;
    const out = buildMemberDescription('999', null, member, t);
    expect(out).toContain('**ID**: `999`');
    expect(out).toContain('**Username**: bob');
    expect(out).toContain('**Banner**: [Link](https://banner)');
    expect(out).toContain('replies:inspect_member_ids.kickable_line');
    expect(out).toContain('replies:inspect_member_ids.bannable_line');
  });
});
