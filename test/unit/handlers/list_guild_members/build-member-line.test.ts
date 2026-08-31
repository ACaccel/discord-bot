/**
 * Pins the Markdown-link sanitisation of member display names: both "]"
 * and "\" must be escaped, in that order, so no display name can break
 * out of the `[name](url)` link text.
 */
import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { buildMemberLine } from '../../../../src/handlers/commands/list_guild_members/index';

const fakeMember = (displayName: string, bot = false): GuildMember =>
  ({
    displayName,
    user: { id: 'u-1', bot },
  }) as unknown as GuildMember;

describe('list_guild_members / buildMemberLine', () => {
  it('renders a plain name as a profile link plus mention', () => {
    expect(buildMemberLine(fakeMember('alice'))).toBe(
      '[alice](https://discord.com/users/u-1) - <@u-1>',
    );
  });

  it('escapes "]" so the name cannot close the link text', () => {
    expect(buildMemberLine(fakeMember('a]b'))).toContain('[a\\]b]');
  });

  it('escapes "\\" so a trailing backslash cannot neutralise the escaped "]"', () => {
    expect(buildMemberLine(fakeMember('evil\\'))).toContain('[evil\\\\]');
  });

  it('escapes a combined "\\]" without double-processing', () => {
    expect(buildMemberLine(fakeMember('x\\]y'))).toContain('[x\\\\\\]y]');
  });

  it('prefixes the BOT badge for bot accounts', () => {
    expect(buildMemberLine(fakeMember('b', true)).startsWith('`[BOT]` ')).toBe(true);
  });
});
