/**
 * Unit tests for the earthquake plugin (D2). Covers plugin shape,
 * the broadcast fan-out, per-guild error isolation, and the
 * sendEarthquakeAlert no-op guards.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Channel, Client } from 'discord.js';
import { createEarthquakePlugin } from '../../../src/plugins/earthquake';
import {
  broadcastEarthquakeAlert,
  sendEarthquakeAlert,
} from '../../../src/plugins/earthquake/internal';
import type { GuildRegistry } from '../../../src/core/guild-registry';
import type { Translator } from '../../../src/core/i18n';
import { createLogger } from '../../../src/core/logger';

const silent = createLogger({ level: 'silent', pretty: false });
const fakeTranslator = {
  t: (key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params ?? {})}`,
} as unknown as Translator;

describe('createEarthquakePlugin', () => {
  it('has the expected bot-scoped plugin shape', () => {
    const plugin = createEarthquakePlugin({ port: 3000 });
    expect(plugin.id).toBe('earthquake');
    expect(plugin.scope).toBe('bot');
    expect(plugin.critical).toBe(false);
    expect(plugin.start).toBeTypeOf('function');
    expect(plugin.onShutdown).toBeTypeOf('function');
  });
});

describe('sendEarthquakeAlert', () => {
  it('sends the translated alert to a sendable channel', async () => {
    const send = vi.fn(async () => undefined);
    const channel = { isSendable: () => true, send } as unknown as Channel;
    await sendEarthquakeAlert(channel, 'role-1', fakeTranslator);
    expect(send).toHaveBeenCalledOnce();
  });

  it('is a no-op for a non-sendable channel', async () => {
    const send = vi.fn(async () => undefined);
    const channel = { isSendable: () => false, send } as unknown as Channel;
    await sendEarthquakeAlert(channel, 'role-1', fakeTranslator);
    expect(send).not.toHaveBeenCalled();
  });

  it('is a no-op when no translator yields an empty message', async () => {
    const send = vi.fn(async () => undefined);
    const channel = { isSendable: () => true, send } as unknown as Channel;
    await sendEarthquakeAlert(channel, 'role-1', undefined);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('broadcastEarthquakeAlert', () => {
  const buildClient = (guildIds: readonly string[]): Client =>
    ({ guilds: { cache: new Map(guildIds.map((id) => [id, { id }])) } }) as unknown as Client;

  it('broadcasts only to guilds with both an earthquake channel and role', async () => {
    const sendA = vi.fn(async () => undefined);
    const registry: GuildRegistry = {
      getRepos: () => undefined,
      getChannel: (guildId: string) =>
        guildId === 'a'
          ? ({ isSendable: () => true, send: sendA } as unknown as Channel)
          : undefined,
      getRole: (guildId: string) => (guildId === 'a' ? ({ id: 'role-a' } as never) : undefined),
    } as unknown as GuildRegistry;

    await broadcastEarthquakeAlert(
      buildClient(['a', 'b']),
      registry,
      fakeTranslator,
      silent,
      'bot-1',
    );
    expect(sendA).toHaveBeenCalledOnce();
  });

  it('isolates a per-guild failure so other guilds still receive the alert', async () => {
    const sendOk = vi.fn(async () => undefined);
    const registry: GuildRegistry = {
      getRepos: () => undefined,
      getChannel: (guildId: string) =>
        guildId === 'bad'
          ? ({
              isSendable: () => true,
              send: async () => {
                throw new Error('Missing Permissions');
              },
            } as unknown as Channel)
          : ({ isSendable: () => true, send: sendOk } as unknown as Channel),
      getRole: () => ({ id: 'role' }) as never,
    } as unknown as GuildRegistry;

    await expect(
      broadcastEarthquakeAlert(
        buildClient(['bad', 'good']),
        registry,
        fakeTranslator,
        silent,
        'bot-1',
      ),
    ).resolves.toBeUndefined();
    expect(sendOk).toHaveBeenCalledOnce();
  });
});
