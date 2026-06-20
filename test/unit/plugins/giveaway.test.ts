import { describe, expect, it } from 'vitest';

import { createGiveawayPlugin } from '../../../src/plugins/giveaway';
import { createActivityPlugin } from '../../../src/plugins/activity';
import { createLogger } from '../../../src/core/logger';
import { systemClock } from '../../../src/core/time';
import { createContainer, TOKENS } from '../../../src/core/ioc';
import type { PluginRuntimeContext } from '../../../src/core/plugin';

const silent = createLogger({ level: 'silent', pretty: false });

// Plugins do not take a `rebootJobs` callback config — they pull their
// deps from `ctx.resolve(...)` and call rebootActivityJobs /
// rebootGiveawayJobs themselves. These tests
// install no-op stubs for the resolved tokens and verify the plugin
// onReady swallows internal failures so startup is not aborted.

const buildCtx = (): PluginRuntimeContext => {
  const container = createContainer();
  // listGuildIds returns [] so the reboot loop is a fast no-op; no
  // need to stub repos / channels.
  container.registerSingleton(TOKENS.GuildRegistry, () => ({
    getRepos: () => undefined,
    getChannel: () => undefined,
    getRole: () => undefined,
    listGuildIds: () => [],
  }));
  container.registerSingleton(
    TOKENS.DiscordClient,
    () => ({ user: { id: 'bot-1' }, guilds: { cache: new Map() } }) as never,
  );
  container.registerSingleton(TOKENS.JobMap, () => new Map());
  return {
    logger: silent,
    translator: { t: (k: string) => k } as PluginRuntimeContext['translator'],
    clock: systemClock,
    resolve: container.resolve.bind(container) as PluginRuntimeContext['resolve'],
  };
};

describe('createGiveawayPlugin / createActivityPlugin — self-owned reboot', () => {
  it('giveaway plugin has the expected shape', () => {
    const p = createGiveawayPlugin();
    expect(p.id).toBe('giveaway');
    expect(p.scope).toBe('bot');
    expect(p.onReady).toBeTypeOf('function');
  });

  it('activity plugin has the expected shape', () => {
    const p = createActivityPlugin();
    expect(p.id).toBe('activity');
    expect(p.scope).toBe('bot');
    expect(p.onReady).toBeTypeOf('function');
  });

  it('giveaway onReady runs to completion with an empty registry', async () => {
    const p = createGiveawayPlugin();
    await expect(p.onReady?.(buildCtx())).resolves.toBeUndefined();
  });

  it('activity onReady runs to completion with an empty registry', async () => {
    const p = createActivityPlugin();
    await expect(p.onReady?.(buildCtx())).resolves.toBeUndefined();
  });
});
