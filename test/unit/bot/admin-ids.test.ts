/**
 * Unit tests for BaseBot's admin resolution.
 *
 * `config.admin` is a list of Discord user ids; the constructor copies it
 * into `adminIds` (defaulting to `[]`) and `isAdmin` is the single
 * membership check the admin-gated handlers use. Constructed through the
 * `Tomori` personality with the handler barrels mocked, matching
 * `tomori-composition.test.ts`.
 */
/* eslint-disable import/first */
import { describe, expect, it } from 'vitest';
import type { Client } from 'discord.js';

import { vi } from 'vitest';

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

import type { Config } from '../../../src/bot/index';
import { Tomori } from '../../../src/bot/tomori/tomori';

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

const buildBot = (config: Config): Tomori =>
  new Tomori(fakeClient(), 'token', '', 'bot-client', config);

describe('BaseBot admin ids', () => {
  it('resolves adminIds from config.admin and matches via isAdmin', () => {
    const bot = buildBot({ admin: ['admin-a', 'admin-b'], commands: [] });
    expect(bot.adminIds).toEqual(['admin-a', 'admin-b']);
    expect(bot.isAdmin('admin-a')).toBe(true);
    expect(bot.isAdmin('admin-b')).toBe(true);
    expect(bot.isAdmin('someone-else')).toBe(false);
  });

  it('defaults adminIds to [] when config omits admin', () => {
    const bot = buildBot({ commands: [] });
    expect(bot.adminIds).toEqual([]);
    expect(bot.isAdmin('anyone')).toBe(false);
  });
});
