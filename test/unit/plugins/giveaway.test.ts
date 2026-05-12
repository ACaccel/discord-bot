import { describe, expect, it, vi } from 'vitest';
import { createGiveawayPlugin } from '../../../src/plugins/giveaway';
import { createActivityPlugin } from '../../../src/plugins/activity';
import { createLogger } from '../../../src/core/logger';
import { systemClock } from '../../../src/core/time';
import { createContainer } from '../../../src/core/ioc';
import type { PluginRuntimeContext } from '../../../src/core/plugin';

const silent = createLogger({ level: 'silent', pretty: false });

const buildCtx = (): PluginRuntimeContext => {
  const container = createContainer();
  return {
    logger: silent,
    translator: { t: (k: string) => k } as PluginRuntimeContext['translator'],
    clock: systemClock,
    resolve: container.resolve.bind(container) as PluginRuntimeContext['resolve'],
  };
};

describe('createGiveawayPlugin / createActivityPlugin', () => {
  it('giveaway plugin has the expected shape', () => {
    const p = createGiveawayPlugin({ rebootJobs: async () => undefined });
    expect(p.id).toBe('giveaway');
    expect(p.scope).toBe('bot');
    expect(p.onReady).toBeTypeOf('function');
  });

  it('activity plugin has the expected shape', () => {
    const p = createActivityPlugin({ rebootJobs: async () => undefined });
    expect(p.id).toBe('activity');
    expect(p.scope).toBe('bot');
    expect(p.onReady).toBeTypeOf('function');
  });

  it('giveaway onReady invokes the reboot callback', async () => {
    const rebootJobs = vi.fn(async () => undefined);
    const p = createGiveawayPlugin({ rebootJobs });
    await p.onReady?.(buildCtx());
    expect(rebootJobs).toHaveBeenCalledTimes(1);
  });

  it('activity onReady invokes the reboot callback', async () => {
    const rebootJobs = vi.fn(async () => undefined);
    const p = createActivityPlugin({ rebootJobs });
    await p.onReady?.(buildCtx());
    expect(rebootJobs).toHaveBeenCalledTimes(1);
  });

  it('giveaway onReady swallows a rebootJobs throw so startup is not aborted', async () => {
    const rebootJobs = vi.fn(async () => {
      throw new Error('boom');
    });
    const p = createGiveawayPlugin({ rebootJobs });
    await expect(p.onReady?.(buildCtx())).resolves.toBeUndefined();
    expect(rebootJobs).toHaveBeenCalledTimes(1);
  });

  it('activity onReady swallows a rebootJobs throw so startup is not aborted', async () => {
    const rebootJobs = vi.fn(async () => {
      throw new Error('boom');
    });
    const p = createActivityPlugin({ rebootJobs });
    await expect(p.onReady?.(buildCtx())).resolves.toBeUndefined();
    expect(rebootJobs).toHaveBeenCalledTimes(1);
  });
});
