/**
 * Unit tests for the `toggle_role` button handler after i18n routing.
 *
 * Covers the three reply branches: role missing, role added, role
 * removed. The handler reads `bot.translator`; the fake returns the key
 * so the test can assert which catalog string each branch selects.
 */
import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ButtonInteraction } from 'discord.js';

import toggle_role from '../../../src/handlers/buttons/toggle_role';
import type { BaseBot } from '../../../src/bot';

const translator = { t: (key: string) => key } as unknown as BaseBot['translator'];
const bot = { translator } as unknown as BaseBot;

const makeMember = (hasRole: boolean) => ({
  roles: {
    cache: { has: () => hasRole },
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
});

const makeInteraction = (
  member: any,
  role: { id: string; name: string } | undefined,
): ButtonInteraction =>
  ({
    customId: 'toggle_role|role-1',
    member,
    guild: { roles: { cache: { get: () => role } } },
    reply: vi.fn().mockResolvedValue(undefined),
  }) as unknown as ButtonInteraction;

describe('toggle_role button handler', () => {
  it('replies role_not_found when the role no longer exists', async () => {
    const member = makeMember(false);
    const interaction = makeInteraction(member, undefined);

    await new toggle_role().execute(interaction, bot);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'replies:toggle_role.role_not_found',
      flags: MessageFlags.Ephemeral,
    });
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(member.roles.remove).not.toHaveBeenCalled();
  });

  it('removes the role and confirms when the member already has it', async () => {
    const member = makeMember(true);
    const interaction = makeInteraction(member, { id: 'role-1', name: 'Notify' });

    await new toggle_role().execute(interaction, bot);

    expect(member.roles.remove).toHaveBeenCalledWith('role-1');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'replies:toggle_role.removed',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('adds the role and confirms when the member lacks it', async () => {
    const member = makeMember(false);
    const interaction = makeInteraction(member, { id: 'role-1', name: 'Notify' });

    await new toggle_role().execute(interaction, bot);

    expect(member.roles.add).toHaveBeenCalledWith('role-1');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'replies:toggle_role.added',
      flags: MessageFlags.Ephemeral,
    });
  });
});
