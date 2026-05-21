/**
 * Integration test for the earthquake plugin's HTTP route (D2).
 *
 * Drives the plugin's real `start` lifecycle hook (a live Express
 * server on a pre-reserved free port), POSTs the webhook, and asserts
 * the per-guild broadcast fires. `onShutdown` must release the socket.
 */
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Channel, Client } from 'discord.js';
import { createEarthquakePlugin } from '../../../src/plugins/earthquake';
import { createContainer } from '../../../src/core/ioc';
import { TOKENS } from '../../../src/core/ioc/tokens';
import type { GuildRegistry } from '../../../src/core/guild-registry';
import type { Translator } from '../../../src/core/i18n';
import { createLogger } from '../../../src/core/logger';
import { systemClock } from '../../../src/core/time';
import type { PluginRuntimeContext, PluginStartContext } from '../../../src/core/plugin';

const silent = createLogger({ level: 'silent', pretty: false });
const fakeTranslator = { t: (key: string) => key } as unknown as Translator;

/** Reserve and immediately release an OS-assigned free TCP port. */
const reserveFreePort = async (): Promise<number> => {
  const probe = createServer();
  return new Promise<number>((resolve, reject) => {
    probe.on('error', reject);
    probe.listen(0, () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
};

let activeShutdown: (() => Promise<void>) | undefined;
afterEach(async () => {
  await activeShutdown?.();
  activeShutdown = undefined;
});

describe('earthquake plugin HTTP route', () => {
  it('broadcasts to configured guilds when the webhook is hit', async () => {
    const send = vi.fn(async () => undefined);
    const client = {
      user: { id: 'bot-1' },
      guilds: { cache: new Map([['g1', { id: 'g1' }]]) },
    } as unknown as Client;
    const registry = {
      getRepos: () => undefined,
      getChannel: () => ({ isSendable: () => true, send }) as unknown as Channel,
      getRole: () => ({ id: 'role-1' }) as never,
    } as unknown as GuildRegistry;

    const container = createContainer();
    container.registerSingleton(TOKENS.DiscordClient, () => client);
    container.registerSingleton(TOKENS.GuildRegistry, () => registry);

    const ctx = {
      logger: silent,
      translator: fakeTranslator,
      clock: systemClock,
      resolve: container.resolve.bind(container),
    } as unknown as PluginStartContext;

    const port = await reserveFreePort();
    const plugin = createEarthquakePlugin({ port });
    await plugin.start?.(ctx);
    activeShutdown = async () => {
      await plugin.onShutdown?.(ctx as unknown as PluginRuntimeContext);
    };

    const res = await fetch(`http://127.0.0.1:${port}/discord/earthquake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);

    // The broadcast is detached; let the event loop flush it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(send).toHaveBeenCalled();
  });

  it('serves the health check on GET /discord/', async () => {
    const client = {
      user: { id: 'bot-1' },
      guilds: { cache: new Map() },
    } as unknown as Client;
    const container = createContainer();
    container.registerSingleton(TOKENS.DiscordClient, () => client);
    container.registerSingleton(
      TOKENS.GuildRegistry,
      () =>
        ({
          getRepos: () => undefined,
          getChannel: () => undefined,
          getRole: () => undefined,
        }) as unknown as GuildRegistry,
    );

    const ctx = {
      logger: silent,
      translator: fakeTranslator,
      clock: systemClock,
      resolve: container.resolve.bind(container),
    } as unknown as PluginStartContext;

    const port = await reserveFreePort();
    const plugin = createEarthquakePlugin({ port });
    await plugin.start?.(ctx);
    activeShutdown = async () => {
      await plugin.onShutdown?.(ctx as unknown as PluginRuntimeContext);
    };

    const res = await fetch(`http://127.0.0.1:${port}/discord/`);
    expect(res.status).toBe(200);
  });
});
