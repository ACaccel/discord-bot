/**
 * Integration test for the guild-events plugin's `guildCreate`
 * subscription.
 *
 * Drives the plugin's real `events.guildCreate` handler with a live
 * IoC container holding a fake {@link GuildOnboardingPort}, and asserts
 * that joining a new guild routes through the port — not through
 * `BaseBot` internals. A failing port must be swallowed (logged, not
 * rethrown) so the dispatcher's per-subscription isolation is not the
 * only safety net.
 */
import type { Guild } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createGuildEventsPlugin } from '../../../src/plugins/guild-events';
import { createContainer } from '../../../src/core/ioc';
import { TOKENS } from '../../../src/core/ioc/tokens';
import { createLogger } from '../../../src/core/logger';
import { systemClock } from '../../../src/core/time';
import type {
  GuildOnboardingPort,
  GuildOnboardingResult,
  PluginEventContext,
} from '../../../src/core/plugin';

const silent = createLogger({ level: 'silent', pretty: false });

const buildEventContext = (port: GuildOnboardingPort): PluginEventContext => {
  const container = createContainer();
  container.registerSingleton(TOKENS.Logger, () => silent);
  container.registerSingleton(TOKENS.GuildOnboardingPort, () => port);
  return {
    logger: silent,
    translator: undefined,
    clock: systemClock,
    resolve: container.resolve.bind(container),
  } as unknown as PluginEventContext;
};

const fakeGuild = (id: string): Guild => ({ id, name: `guild-${id}` }) as unknown as Guild;

describe('guild-events plugin guildCreate subscription', () => {
  it('exposes a guildCreate subscription', () => {
    const plugin = createGuildEventsPlugin();
    expect(plugin.events?.guildCreate).toBeTypeOf('function');
  });

  it('onboards a newly joined guild through GuildOnboardingPort', async () => {
    const result: GuildOnboardingResult = {
      guildId: 'g-100',
      databaseConnected: true,
      commandsRegistered: true,
    };
    const onboardGuild = vi.fn(async () => result);
    const port: GuildOnboardingPort = { onboardGuild };

    const plugin = createGuildEventsPlugin();
    const ctx = buildEventContext(port);

    await plugin.events?.guildCreate?.(ctx, fakeGuild('g-100'));

    expect(onboardGuild).toHaveBeenCalledTimes(1);
    expect(onboardGuild).toHaveBeenCalledWith('g-100');
  });

  it('swallows a failing onboarding so the subscription never rejects', async () => {
    const onboardGuild = vi.fn(async () => {
      throw new Error('mongo unreachable');
    });
    const port: GuildOnboardingPort = { onboardGuild };

    const plugin = createGuildEventsPlugin();
    const ctx = buildEventContext(port);

    // The contract this regression test protects: a port failure is
    // logged, not rethrown — onboarding is a structural side effect.
    await expect(plugin.events?.guildCreate?.(ctx, fakeGuild('g-200'))).resolves.toBeUndefined();
    expect(onboardGuild).toHaveBeenCalledTimes(1);
  });
});
