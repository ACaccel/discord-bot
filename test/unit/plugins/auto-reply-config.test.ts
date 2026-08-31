/**
 * Auto-reply operator configuration.
 *
 * The per-user lucky replies used to be five module constants — two
 * Discord user ids, two probabilities, and two catalog keys holding one
 * server's in-jokes. They are operator data, so they live in
 * `config.json` and the plugin reads them from there.
 */
import { describe, expect, it, vi } from 'vitest';

import { createAutoReplyPlugin } from '../../../src/plugins/auto-reply';
import { parseAutoReplyConfig } from '../../../src/plugins/auto-reply/config';
import { createLogger } from '../../../src/core/logger';
import { TOKENS } from '../../../src/bot/tokens';
import type { Plugin, PluginEventContext, PluginInitContext } from '../../../src/core/plugin';
import type { GuildRegistry } from '../../../src/bot/guild-registry';

const silent = createLogger({ level: 'silent', pretty: false });

/** A well-formed snowflake; the schema rejects anything else. */
const LUCKY_USER_ID = '516912789369913371';

describe('parseAutoReplyConfig', () => {
  it('defaults to no lucky replies and the 0.5% global probability', () => {
    expect(parseAutoReplyConfig(undefined)).toEqual({
      luckyReplies: [],
      globalLuckyProbability: 0.005,
    });
  });

  it('accepts a fully specified block', () => {
    const parsed = parseAutoReplyConfig({
      luckyReplies: [{ userId: '516912789369913371', probability: 0.01, reply: 'hi' }],
      globalLuckyProbability: 0.02,
    });
    expect(parsed.luckyReplies).toHaveLength(1);
    expect(parsed.globalLuckyProbability).toBe(0.02);
  });

  it('rejects a probability outside 0–1', () => {
    expect(() =>
      parseAutoReplyConfig({
        luckyReplies: [{ userId: '516912789369913371', probability: 5, reply: 'hi' }],
      }),
    ).toThrow();
    expect(() => parseAutoReplyConfig({ globalLuckyProbability: -1 })).toThrow();
  });

  it('rejects a userId that is not a snowflake', () => {
    // A typo'd id parses under a bare `min(1)` and then never matches,
    // with nothing to show the operator why.
    expect(() =>
      parseAutoReplyConfig({
        luckyReplies: [{ userId: 'not-an-id', probability: 0.5, reply: 'hi' }],
      }),
    ).toThrow();
  });

  it('rejects an empty reply and an unknown key', () => {
    expect(() =>
      parseAutoReplyConfig({
        luckyReplies: [{ userId: '516912789369913371', probability: 0.5, reply: '' }],
      }),
    ).toThrow();
    expect(() => parseAutoReplyConfig({ typoedKey: true })).toThrow();
  });
});

/** Minimal event context: only `resolve`, `logger` and `translator` are read. */
const buildCtx = (): PluginEventContext => {
  const registry: GuildRegistry = {
    getRepos: () => undefined,
    getChannel: () => undefined,
    getRole: () => undefined,
    listGuildIds: () => [],
  };
  return {
    logger: silent,
    translator: { t: (key: string) => key },
    clock: { now: () => 0, nowDate: () => new Date(0) },
    resolve: ((token: unknown) =>
      token === TOKENS.GuildRegistry ? registry : undefined) as PluginEventContext['resolve'],
  } as unknown as PluginEventContext;
};

/**
 * The host resolves a plugin's dependencies in `init` and only then
 * attaches its subscription, so a hand-driven dispatch runs both steps.
 */
const deliver = async (
  plugin: ReturnType<typeof createAutoReplyPlugin>,
  message: Parameters<NonNullable<NonNullable<Plugin['events']>['messageCreate']>>[1],
): Promise<void> => {
  const ctx = buildCtx();
  await plugin.init?.(ctx as unknown as PluginInitContext);
  await plugin.events?.messageCreate?.(ctx, message);
};

const messageFrom = (authorId: string, send: ReturnType<typeof vi.fn>) =>
  ({
    content: 'anything',
    guildId: 'g1',
    author: { id: authorId, bot: false },
    channel: { isSendable: () => true, send },
    reply: vi.fn(),
  }) as never;

describe('createAutoReplyPlugin dependency wiring', () => {
  it('refuses to run an event that somehow precedes init', async () => {
    // The host never dispatches to a plugin whose init did not run;
    // raising keeps a mis-wired plugin from looking alive and idle.
    const plugin = createAutoReplyPlugin();
    const send = vi.fn(async () => undefined);
    await expect(
      plugin.events?.messageCreate?.(buildCtx(), messageFrom('u1', send)),
    ).rejects.toThrow(/dispatched before init/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('createAutoReplyPlugin lucky replies', () => {
  it('sends the configured line for the configured user', async () => {
    const send = vi.fn(async () => undefined);
    const plugin = createAutoReplyPlugin({
      luckyReplies: [{ userId: LUCKY_USER_ID, probability: 1, reply: 'configured line' }],
      globalLuckyProbability: 0,
    });

    await deliver(plugin, messageFrom(LUCKY_USER_ID, send));

    // Mentions are disabled: the text is operator config, not catalog copy.
    expect(send).toHaveBeenCalledWith({
      content: 'configured line',
      allowedMentions: { parse: [] },
    });
  });

  it('sends nothing for a user who has no entry', async () => {
    const send = vi.fn(async () => undefined);
    const plugin = createAutoReplyPlugin({
      luckyReplies: [{ userId: LUCKY_USER_ID, probability: 1, reply: 'configured line' }],
      globalLuckyProbability: 0,
    });

    await deliver(plugin, messageFrom('someone-else', send));

    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when the block is omitted entirely', async () => {
    const send = vi.fn(async () => undefined);
    const plugin = createAutoReplyPlugin();

    await deliver(plugin, messageFrom(LUCKY_USER_ID, send));

    expect(send).not.toHaveBeenCalled();
  });
});
