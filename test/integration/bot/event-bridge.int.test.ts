/**
 * Contract baseline: BaseBot's raw `client.on(...)` listeners (the 8
 * branches captured before the R1 ClientEventBridge extraction).
 *
 * Drives a minimal BaseBot subclass through `run()`, then fires fake
 * Discord events into the captured listeners and asserts the expected
 * downstream calls. Locked in BEFORE the R1 decomposition so the
 * post-R1 ClientEventBridge tests have a behavioural anchor.
 */
import { Events } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';

vi.mock('@cmd', () => ({
  registerCommands: async (): Promise<void> => {},
  getCommandJsonBody: (): unknown[] => [],
  executeCommand: async (): Promise<void> => {},
}));
vi.mock('@button', () => ({
  registerButtons: async (): Promise<void> => {},
  executeButton: async (): Promise<void> => {},
}));
vi.mock('@modal', () => ({
  registerModals: async (): Promise<void> => {},
  executeModal: async (): Promise<void> => {},
}));
vi.mock('@select-menu', () => ({
  registerSSMs: async (): Promise<void> => {},
  executeSSM: async (): Promise<void> => {},
}));
vi.mock('@reaction', () => ({
  registerReactions: async (): Promise<void> => {},
  executeReactionAdded: async (): Promise<void> => {},
  executeReactionRemoved: async (): Promise<void> => {},
}));

import { BaseBot, type Config } from '../../../src/bot/index';
import { TOKENS } from '../../../src/core/ioc';
import type { GuildOnboardingPort } from '../../../src/core/plugin';

interface BridgeFakeClient {
  readonly client: Client;
  readonly listeners: Map<string, Array<(...args: unknown[]) => unknown>>;
  fire(event: string, ...args: unknown[]): Promise<void>;
}

const buildBridgeFakeClient = (): BridgeFakeClient => {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const append = (event: string, fn: (...args: unknown[]) => unknown): void => {
    const arr = listeners.get(event) ?? [];
    arr.push(fn);
    listeners.set(event, arr);
  };
  const client = {
    user: { id: 'bot-1', username: 'Botty' },
    guilds: { cache: new Map() },
    channels: { cache: new Map() },
    application: { commands: { set: vi.fn(async () => []) } },
    login: async (t: string) => t,
    destroy: () => {},
    on: (event: string, fn: (...args: unknown[]) => unknown) => {
      append(event, fn);
      return client;
    },
    once: (event: string, fn: (...args: unknown[]) => unknown) => {
      append(event, fn);
      return client;
    },
    off: () => client,
  } as unknown as Client;
  return {
    client,
    listeners,
    async fire(event, ...args) {
      for (const fn of [...(listeners.get(event) ?? [])]) {
        await fn(...args);
      }
    },
  };
};

class MinimalBot extends BaseBot<Config> {}

describe('BaseBot raw client.on listeners — contract baseline', () => {
  it('routes InteractionCreate through the interaction router', async () => {
    const fake = buildBridgeFakeClient();
    const bot = new MinimalBot(fake.client, 'tk', '', 'bot-1', {});
    await bot.run();

    const dispatch = vi.fn(async () => {});
    // Patch in a router so the dispatch path is observable. Cast
    // through `unknown` to reach the protected field without
    // widening the public surface.
    (bot as unknown as { interactionRouter: { dispatch: typeof dispatch } }).interactionRouter = {
      dispatch,
    };

    const fakeInteraction = {
      isAutocomplete: () => false,
      isRepliable: () => true,
      isChatInputCommand: () => false,
      isContextMenuCommand: () => false,
      isModalSubmit: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      guildId: 'g-1',
      reply: async () => {},
    };
    await fake.fire(Events.InteractionCreate, fakeInteraction);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('ignores bot-authored reactions for MessageReactionAdd', async () => {
    const fake = buildBridgeFakeClient();
    const bot = new MinimalBot(fake.client, 'tk', '', 'bot-1', {});
    await bot.run();

    const reaction = {
      partial: false,
      message: { guildId: 'g-1' },
      fetch: async () => reaction,
    };
    const user = { partial: false, bot: true, fetch: async () => user };

    // Should not throw; bot user reactions are dropped before any
    // per-handler dispatch runs.
    await expect(fake.fire(Events.MessageReactionAdd, reaction, user)).resolves.toBeUndefined();
  });

  it('routes GuildCreate through GuildOnboardingPort when no plugin owns the event', async () => {
    const fake = buildBridgeFakeClient();
    const bot = new MinimalBot(fake.client, 'tk', '', 'bot-1', {});
    await bot.run();

    // The port BaseBot registered by default — wrap its method so
    // the spy observes the exact call coming from the listener.
    const port = bot.container.resolve<GuildOnboardingPort>(TOKENS.GuildOnboardingPort);
    const onboardSpy = vi.spyOn(port, 'onboardGuild').mockResolvedValue({
      guildId: 'g-9',
      databaseConnected: false,
      commandsRegistered: false,
    });

    await fake.fire(Events.GuildCreate, { id: 'g-9' });
    expect(onboardSpy).toHaveBeenCalledWith('g-9');
  });

  it('messageCreate / messageUpdate / messageDelete / guildMemberUpdate default to no-op', async () => {
    const fake = buildBridgeFakeClient();
    const bot = new MinimalBot(fake.client, 'tk', '', 'bot-1', {});
    await bot.run();

    await expect(fake.fire(Events.MessageCreate, { guildId: 'g-1' })).resolves.toBeUndefined();
    await expect(
      fake.fire(Events.MessageUpdate, { guildId: 'g-1' }, { guildId: 'g-1' }),
    ).resolves.toBeUndefined();
    await expect(fake.fire(Events.MessageDelete, { guildId: 'g-1' })).resolves.toBeUndefined();
    await expect(
      fake.fire(Events.GuildMemberUpdate, { guild: { id: 'g-1' } }, { guild: { id: 'g-1' } }),
    ).resolves.toBeUndefined();
  });
});
