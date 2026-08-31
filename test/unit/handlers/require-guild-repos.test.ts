/**
 * Unit coverage for `requireGuildRepos`.
 *
 * The disabled-guild guard reads `ConnectionManager.isDisabled` straight
 * off `BaseBot.connectionManager`, and the `traceId` surfaced to the user
 * must be the one the manager stamped.
 */
import { describe, expect, it } from 'vitest';

import type { BaseBot } from '../../../src/bot/index';
import { requireGuildRepos } from '../../../src/handlers/require-guild-repos';
import { buildFakeBot, echoTranslatorWithParams } from '../../fixtures/discord/bot-fake';

/** Minimal interaction fake recording reply payloads. */
const stubInteraction = (guildId: string | undefined) => {
  const replies: Array<{ content?: string }> = [];
  return {
    interaction: {
      guild: guildId === undefined ? undefined : { id: guildId },
      deferred: false,
      replied: false,
      reply: async (opts: { content?: string }) => {
        replies.push(opts);
      },
      editReply: async (opts: { content?: string }) => {
        replies.push(opts);
      },
    } as never,
    replies,
  };
};

interface StubBotInput {
  readonly disabled?: { guildId: string; traceId: string };
  readonly repos?: Readonly<Record<string, unknown>>;
}

/** A `BaseBot`-shaped stub exposing only what `requireGuildRepos` reads. */
const stubBot = (input: StubBotInput = {}): BaseBot => {
  const disabledMap = new Map<string, { traceId: string; error: Error }>();
  if (input.disabled) {
    disabledMap.set(input.disabled.guildId, {
      traceId: input.disabled.traceId,
      error: new Error('boot failure'),
    });
  }
  return buildFakeBot({
    clientId: 'bot-1',
    translator: echoTranslatorWithParams('|'),
    connectionManager: {
      isDisabled: (guildId: string) => disabledMap.get(guildId),
    },
    getRepos: (guildId: string) => (guildId === 'g-1' ? input.repos : undefined),
  }).bot;
};

describe('requireGuildRepos — reads ConnectionManager.isDisabled', () => {
  it('replies guild_only and returns null outside a guild', async () => {
    const { interaction, replies } = stubInteraction(undefined);
    const result = await requireGuildRepos(stubBot(), interaction);
    expect(result).toBeNull();
    expect(replies[0]?.content).toBe('errors:command.guild_only');
  });

  it('replies guild_disabled with the manager traceId for a disabled guild', async () => {
    const { interaction, replies } = stubInteraction('g-1');
    const bot = stubBot({ disabled: { guildId: 'g-1', traceId: '7f3a2c' } });
    const result = await requireGuildRepos(bot, interaction);
    expect(result).toBeNull();
    expect(replies[0]?.content).toBe('errors:db.guild_disabled|{"traceId":"7f3a2c"}');
  });

  it('replies not_found when the guild has no repos bundle', async () => {
    const { interaction, replies } = stubInteraction('g-1');
    const result = await requireGuildRepos(stubBot(), interaction);
    expect(result).toBeNull();
    expect(replies[0]?.content).toBe('errors:db.not_found');
  });

  it('returns the Repos bundle for a healthy guild', async () => {
    const { interaction, replies } = stubInteraction('g-1');
    const repos = { reply: {} };
    const result = await requireGuildRepos(stubBot({ repos }), interaction);
    expect(result).toBe(repos);
    expect(replies).toHaveLength(0);
  });

  it('treats an absent ConnectionManager as "not disabled"', async () => {
    const { interaction, replies } = stubInteraction('g-1');
    const repos = { reply: {} };
    const { bot } = buildFakeBot({
      clientId: 'bot-1',
      translator: echoTranslatorWithParams('|'),
      connectionManager: undefined,
      getRepos: (guildId: string) => (guildId === 'g-1' ? repos : undefined),
    });
    const result = await requireGuildRepos(bot, interaction);
    expect(result).toBe(repos);
    expect(replies).toHaveLength(0);
  });
});
