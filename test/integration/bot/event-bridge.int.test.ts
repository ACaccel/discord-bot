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

    // Spy on the live router the bridge captured during attach so the
    // assertion reflects the production dispatch path rather than a
    // post-hoc property swap.
    const router = (
      bot as unknown as { interactionRouter: { dispatch: (ctx: unknown) => Promise<void> } }
    ).interactionRouter;
    const dispatchSpy = vi.spyOn(router, 'dispatch').mockResolvedValue(undefined);

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
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
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

  it('does not install raw listeners for pure-plugin events when no plugin subscribes', async () => {
    const fake = buildBridgeFakeClient();
    const bot = new MinimalBot(fake.client, 'tk', '', 'bot-1', {});
    await bot.run();

    // Post-R1: messageCreate / messageUpdate / messageDelete /
    // guildMemberUpdate are EventDispatcher-driven. The bridge only
    // attaches them when a plugin subscribes; this MinimalBot has none.
    for (const event of [
      Events.MessageCreate,
      Events.MessageUpdate,
      Events.MessageDelete,
      Events.GuildMemberUpdate,
    ]) {
      expect(fake.listeners.get(event)?.length ?? 0).toBe(0);
    }
  });
});
