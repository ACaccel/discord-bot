/**
 * Composition test for the Tomori personality.
 *
 * Tomori must register the full interactive plugin set — crucially
 * `guild-events`, which is what subscribes to `messageUpdate` /
 * `messageDelete` / `guildMemberUpdate` / `guildCreate`. A drift where
 * that registration is dropped silently disables all message-event
 * logging (the ClientEventBridge only wires Discord events a plugin
 * subscribes to), and nothing else in the suite would catch it. This
 * test pins the contract by spying on `BaseBot.prototype.use` and
 * asserting the registered plugin ids.
 */
/* eslint-disable import/first */
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
import { Tomori } from '../../../src/bot/tomori/tomori';
import type { Plugin } from '../../../src/core/plugin';

const fakeClient = (): Client =>
  ({
    user: null,
    guilds: { cache: new Map() },
    channels: { cache: new Map() },
    application: null,
    on: () => undefined,
    once: () => undefined,
    off: () => undefined,
    destroy: () => undefined,
  }) as unknown as Client;

const collectRegisteredPluginIds = (): string[] => {
  const ids: string[] = [];
  const useSpy = vi.spyOn(BaseBot.prototype, 'use').mockImplementation(function (
    this: BaseBot,
    plugin: Plugin<unknown>,
  ) {
    ids.push(plugin.id);
    return this;
  });
  try {
    new Tomori(fakeClient(), 'token', '', 'bot-client', { commands: [] } satisfies Config);
  } finally {
    useSpy.mockRestore();
  }
  return ids;
};

describe('Tomori composition', () => {
  it('registers the full interactive plugin set including guild-events', () => {
    const ids = collectRegisteredPluginIds();
    expect(new Set(ids)).toEqual(
      new Set(['auto-reply', 'guild-events', 'giveaway', 'activity', 'voice']),
    );
  });

  it('registers guild-events so message edit/delete events are logged', () => {
    // The reported bug: without this plugin the bot never subscribes to
    // messageUpdate / messageDelete, so no audit log is produced.
    expect(collectRegisteredPluginIds()).toContain('guild-events');
  });
});
