/**
 * Integration test for the settings-api plugin's HTTP route.
 *
 * Drives the plugin's real `start` lifecycle hook (a live Express server
 * on a pre-reserved free port) and asserts the auth gate, body validation,
 * read/update of the injected endpoint cell, and that `onShutdown` releases
 * the socket. Also covers the two fail-closed skips (disabled, missing key):
 * the server must not listen at all.
 */
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSettingsApiPlugin } from '../../../src/plugins/settings-api';
import { createLogger } from '../../../src/core/logger';
import { systemClock } from '../../../src/core/time';
import type { Translator } from '../../../src/core/i18n';
import type { PluginRuntimeContext, PluginStartContext } from '../../../src/core/plugin';

const silent = createLogger({ level: 'silent', pretty: false });
const fakeTranslator = { t: (key: string) => key } as unknown as Translator;

const ctx = {
  logger: silent,
  translator: fakeTranslator,
  clock: systemClock,
  // settings-api does not resolve from the container; a throwing stub
  // documents that nothing in this plugin reaches for a token.
  resolve: () => {
    throw new Error('settings-api must not resolve container tokens');
  },
} as unknown as PluginStartContext;

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

const API_KEY = 'test-secret-key';

let activeShutdown: (() => Promise<void>) | undefined;
afterEach(async () => {
  await activeShutdown?.();
  activeShutdown = undefined;
});

interface Harness {
  readonly port: number;
  readonly url: (path: string) => string;
  readonly setEndpoint: ReturnType<typeof vi.fn>;
  current: string;
}

/**
 * Stand up an enabled settings-api server on a free port with a mutable
 * endpoint cell, returning helpers to drive it. Registers teardown.
 */
const startServer = async (
  overrides: { apiKey?: string | undefined; enabled?: boolean } = {},
): Promise<Harness> => {
  const port = await reserveFreePort();
  const harness: Harness = {
    port,
    url: (path: string) => `http://127.0.0.1:${port}/settings${path}`,
    setEndpoint: vi.fn(),
    current: 'https://old.invalid/chat',
  };
  harness.setEndpoint.mockImplementation(async (url: string) => {
    harness.current = url;
  });

  const plugin = createSettingsApiPlugin(
    { enabled: overrides.enabled ?? true, host: '127.0.0.1' },
    {
      port,
      apiKey: 'apiKey' in overrides ? overrides.apiKey : API_KEY,
      getEndpoint: () => harness.current,
      setEndpoint: harness.setEndpoint as unknown as (url: string) => Promise<void>,
    },
  );
  await plugin.start?.(ctx);
  activeShutdown = async () => {
    await plugin.onShutdown?.(ctx as unknown as PluginRuntimeContext);
  };
  return harness;
};

const authed = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { Authorization: `Bearer ${API_KEY}`, ...(extra.headers ?? {}) },
});

describe('settings-api plugin HTTP route', () => {
  it('rejects requests without a valid bearer token (401)', async () => {
    const h = await startServer();

    const noHeader = await fetch(h.url('/endpoint'));
    expect(noHeader.status).toBe(401);

    const wrongKey = await fetch(h.url('/endpoint'), {
      headers: { Authorization: 'Bearer not-the-key' },
    });
    expect(wrongKey.status).toBe(401);

    // `Bearer ` with an empty token must also be rejected (length mismatch).
    const emptyToken = await fetch(h.url('/endpoint'), {
      headers: { Authorization: 'Bearer ' },
    });
    expect(emptyToken.status).toBe(401);
  });

  it('returns the current endpoint on GET with a valid token', async () => {
    const h = await startServer();
    const res = await fetch(h.url('/endpoint'), authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ endpoint: 'https://old.invalid/chat' });
  });

  it('updates and persists the endpoint on a valid PUT', async () => {
    const h = await startServer();
    const res = await fetch(
      h.url('/endpoint'),
      authed({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://new.invalid/chat' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ endpoint: 'https://new.invalid/chat' });
    expect(h.setEndpoint).toHaveBeenCalledWith('https://new.invalid/chat');

    // The swap is observable on the next GET.
    const after = await fetch(h.url('/endpoint'), authed());
    expect(await after.json()).toEqual({ endpoint: 'https://new.invalid/chat' });
  });

  it('rejects a malformed body (400) without calling setEndpoint', async () => {
    const h = await startServer();
    const res = await fetch(
      h.url('/endpoint'),
      authed({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'not-a-url' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(h.setEndpoint).not.toHaveBeenCalled();
  });

  it('returns 500 when persistence fails, without crashing the server', async () => {
    const h = await startServer();
    h.setEndpoint.mockRejectedValueOnce(new Error('disk full'));
    const res = await fetch(
      h.url('/endpoint'),
      authed({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://new.invalid/chat' }),
      }),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'persist_failed' });

    // The server must still be serving after the failed write.
    const after = await fetch(h.url('/endpoint'), authed());
    expect(after.status).toBe(200);
  });

  it('does not start the server when disabled', async () => {
    const h = await startServer({ enabled: false });
    const outcome = await fetch(h.url('/endpoint'), authed())
      .then(() => 'reachable')
      .catch(() => 'refused');
    expect(outcome).toBe('refused');
  });

  it('does not start the server when enabled but no API key is configured', async () => {
    const h = await startServer({ apiKey: undefined });
    const outcome = await fetch(h.url('/endpoint'))
      .then(() => 'reachable')
      .catch(() => 'refused');
    expect(outcome).toBe('refused');
  });
});
