/**
 * Discord `Client` stand-in for tests that construct a personality but
 * never let it reach the gateway.
 *
 * The listener methods are no-ops rather than recorders: these tests ask
 * what a composition root wired up, not what it subscribed to. A test
 * that needs to fire events at the client wants a recording client of
 * its own (see `test/unit/bot/event-bridge-attach.test.ts`).
 */
import type { Client } from 'discord.js';

interface BuildInertClientInput {
  /** `client.user`; `null` models the pre-login state. */
  readonly user?: { readonly id: string; readonly username: string } | null;
}

export const buildInertClient = (input: BuildInertClientInput = {}): Client =>
  ({
    user: input.user ?? null,
    guilds: { cache: new Map() },
    channels: { cache: new Map() },
    application: null,
    on: () => undefined,
    once: () => undefined,
    off: () => undefined,
    destroy: () => undefined,
  }) as unknown as Client;
