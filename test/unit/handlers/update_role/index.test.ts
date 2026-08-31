/**
 * `/update_role` guard rails.
 *
 * The handler used to narrow its config with `'level_roles' in
 * bot.config` (true for a `level_roles: 42` typo) and then dereference
 * `bot.getGuildInfo(...)!`, which crashed outright on any guild the bot
 * had not registered.
 */
/* eslint-disable import/first */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';

const getLeaderboardPage = vi.fn(async (_guildId: string) => []);
vi.mock('mee6-levels-api', () => ({
  default: { getLeaderboardPage: (guildId: string) => getLeaderboardPage(guildId) },
}));

import UpdateRole from '../../../../src/handlers/commands/update_role';
import { buildFakeBot } from '../../../fixtures/discord/bot-fake';

const GUILD_ID = 'g1';

interface Fixture {
  readonly config?: unknown;
  readonly registered?: boolean;
}

const build = ({ config = { level_roles: { level_1: 'Rookie' } }, registered = true }: Fixture) => {
  const { bot } = buildFakeBot({
    config,
    getGuildInfo: () =>
      registered
        ? { guild: { members: { cache: new Map() }, roles: { cache: new Map() } } }
        : undefined,
  });

  const interaction = {
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    deferred: true,
    replied: false,
    guild: { id: GUILD_ID },
    channel: { isSendable: () => true, send: vi.fn(async () => undefined) },
    options: { get: () => undefined },
  } as unknown as ChatInputCommandInteraction;

  return { bot, interaction };
};

afterEach(() => vi.clearAllMocks());

describe('update_role', () => {
  it('answers an unregistered guild instead of crashing on it', async () => {
    const { bot, interaction } = build({ registered: false });

    await new UpdateRole().execute(interaction, bot);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'errors:command.guild_not_found',
    });
    // The non-null assertion this replaces threw before reaching here.
    expect(getLeaderboardPage).not.toHaveBeenCalled();
  });

  it('answers a missing level_roles block', async () => {
    const { bot, interaction } = build({ config: {} });

    await new UpdateRole().execute(interaction, bot);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'replies:update_role.no_config',
    });
    expect(getLeaderboardPage).not.toHaveBeenCalled();
  });

  it('rejects a malformed level_roles block a property check would have accepted', async () => {
    const { bot, interaction } = build({ config: { level_roles: 42 } });

    await new UpdateRole().execute(interaction, bot);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'replies:update_role.no_config',
    });
    expect(getLeaderboardPage).not.toHaveBeenCalled();
  });

  it('runs the sync for a well-formed config on a registered guild', async () => {
    const { bot, interaction } = build({});

    await new UpdateRole().execute(interaction, bot);

    expect(getLeaderboardPage).toHaveBeenCalledWith(GUILD_ID);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'replies:update_role.done' });
  });
});
