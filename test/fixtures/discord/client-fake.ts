/**
 * Minimal `Client` fake for plugin / host unit tests. Carries a
 * `user.id`, a `guilds.cache` Map, and supports `login` / `on` /
 * `once` no-ops. Listeners can be pumped via `fireEvent` to drive
 * Event-Dispatcher / InteractionRouter integration tests.
 */
import type { Client } from 'discord.js';

export interface FakeClientHandle {
  readonly client: Client;
  /** Fire a stored event listener by name. */
  fireEvent(event: string, ...args: unknown[]): Promise<void>;
}

export const buildFakeClient = (
  init: { userId?: string; guilds?: readonly { id: string; name?: string }[] } = {},
): FakeClientHandle => {
  const guildCache = new Map<string, unknown>();
  for (const g of init.guilds ?? []) {
    guildCache.set(g.id, { id: g.id, name: g.name ?? 'TestGuild' });
  }
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const append = (event: string, fn: (...args: unknown[]) => unknown): void => {
    const arr = listeners.get(event) ?? [];
    arr.push(fn);
    listeners.set(event, arr);
  };
  const client = {
    user: { id: init.userId ?? 'bot-1' },
    guilds: { cache: guildCache },
    login: async () => 'token',
    on: (event: string, fn: (...args: unknown[]) => unknown) => {
      append(event, fn);
      return client;
    },
    once: (event: string, fn: (...args: unknown[]) => unknown) => {
      append(event, fn);
      return client;
    },
  } as unknown as Client;
  return {
    client,
    async fireEvent(event, ...args) {
      for (const fn of listeners.get(event) ?? []) {
        await fn(...args);
      }
    },
  };
};
