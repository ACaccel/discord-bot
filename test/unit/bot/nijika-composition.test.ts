/**
 * Composition test for the Nijika personality.
 *
 * Pins the post-port contract: nijika keeps its full interactive plugin
 * set but NO LONGER registers `llm-auto-reply` (that feature moved to the
 * gopher personality). A regression that re-adds it — or drops one of the
 * remaining plugins — is caught here by spying on `BaseBot.prototype.use`.
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

import { BaseBot } from '../../../src/bot/index';
import { Nijika } from '../../../src/bot/nijika/nijika';
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
    new Nijika(
      fakeClient(),
      'token',
      '',
      'bot-client',
      { commands: [], blocked_channels: [], level_roles: {} },
      3000,
    );
  } finally {
    useSpy.mockRestore();
  }
  return ids;
};

describe('Nijika composition', () => {
  it('registers its full interactive plugin set', () => {
    expect(new Set(collectRegisteredPluginIds())).toEqual(
      new Set([
        'auto-reply',
        'guild-events',
        'social-link-preview',
        'giveaway',
        'activity',
        'voice',
        'earthquake',
      ]),
    );
  });

  it('no longer registers llm-auto-reply (moved to gopher)', () => {
    expect(collectRegisteredPluginIds()).not.toContain('llm-auto-reply');
  });
});
