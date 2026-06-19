/**
 * Handler-level tests for `handleGiveawayDeleteSelection`: the selected
 * giveaway (carried as the select value) is deleted — its scheduled
 * draw job is cancelled and the document removed — and the invoker gets
 * an ephemeral confirmation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';

import { ok } from '../../../src/core/result';
import { handleGiveawayDeleteSelection } from '../../../src/plugins/giveaway/internal/handlers';
import type { BaseBot } from '../../../src/bot';

const GUILD_ID = 'guild-1';
const MESSAGE_ID = 'm1';

const translator = { t: (key: string) => key } as unknown as BaseBot['translator'];

const makeRepos = () => ({
  giveaway: {
    deleteByMessageId: vi.fn().mockResolvedValue(ok(true)),
  },
});

const makeBot = (repos: ReturnType<typeof makeRepos>) =>
  ({
    client: { guilds: { cache: new Map([[GUILD_ID, {}]]) } },
    getRepos: (guildId: string) => (guildId === GUILD_ID ? repos : undefined),
    getGuildInfo: () => undefined,
    getAllGuildInfo: () => new Map(),
    jobs: new Map(),
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    translator,
  }) as unknown as BaseBot;

const makeInteraction = (values: string[]) =>
  ({
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    guild: { id: GUILD_ID },
    values,
  }) as unknown as StringSelectMenuInteraction;

afterEach(() => vi.clearAllMocks());

describe('handleGiveawayDeleteSelection', () => {
  it('deletes the selected giveaway and confirms', async () => {
    const repos = makeRepos();
    const bot = makeBot(repos);
    const interaction = makeInteraction([MESSAGE_ID]);

    await handleGiveawayDeleteSelection(interaction, bot);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(repos.giveaway.deleteByMessageId).toHaveBeenCalledWith(MESSAGE_ID);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'replies:giveaway.delete_success',
    });
  });

  it('rejects when no giveaway was selected', async () => {
    const repos = makeRepos();
    const bot = makeBot(repos);
    const interaction = makeInteraction([]);

    await handleGiveawayDeleteSelection(interaction, bot);

    expect(repos.giveaway.deleteByMessageId).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'replies:giveaway.missing_message_id',
    });
  });
});
