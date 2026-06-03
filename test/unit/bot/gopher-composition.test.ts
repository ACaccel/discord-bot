/**
 * Composition test for the Gopher personality.
 *
 * Gopher must register exactly the ported auto-reply plus its two
 * gopher-only plugins (settings-api, identity-sync). A drift where any is
 * dropped (or where llm-chat / earthquake leak in) would silently change
 * the bot's behaviour, and nothing else in the suite would catch it. This
 * test pins the contract by spying on `BaseBot.prototype.use`.
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
import { Gopher } from '../../../src/bot/gopher/gopher';
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
    // The store reads the colocated config.json; gopher is database-free so
    // an empty mongoURI is passed deliberately.
    new Gopher(
      fakeClient(),
      'token',
      '',
      'bot-client',
      { commands: ['help'] } satisfies Config,
      4001,
      'key',
    );
  } finally {
    useSpy.mockRestore();
  }
  return ids;
};

describe('Gopher composition', () => {
  it('registers the ported auto-reply plus the two gopher-only plugins', () => {
    const ids = collectRegisteredPluginIds();
    expect(new Set(ids)).toEqual(new Set(['llm-auto-reply', 'settings-api', 'identity-sync']));
  });

  it('does not register llm-chat or earthquake', () => {
    const ids = collectRegisteredPluginIds();
    expect(ids).not.toContain('llm-chat');
    expect(ids).not.toContain('earthquake');
  });
});
