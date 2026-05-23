/**
 * Unit tests for PluginLifecycleRunner (D6). Exercises each lifecycle
 * phase, cascade-disable, and critical-escalation against a fake
 * LifecycleHost — no PluginHost wiring required.
 */
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../../src/core/logger';
import { systemClock } from '../../../../src/core/time';
import { createContainer } from '../../../../src/core/ioc';
import { EventDispatcher } from '../../../../src/core/plugin/event-dispatcher';
import {
  PluginLifecycleRunner,
  type LifecycleHost,
  type RegisteredPlugin,
} from '../../../../src/core/plugin/host/lifecycle';
import { CriticalPluginFailureError } from '../../../../src/core/plugin/host/errors';
import { buildDependentsIndex } from '../../../../src/core/plugin/host/topology';
import type { DisabledPlugin, Plugin, PluginId } from '../../../../src/core/plugin/types';

const silent = createLogger({ level: 'silent', pretty: false });
const fakeTranslator = { t: (k: string) => k } as LifecycleHost['translator'];

const plugin = (p: Partial<Plugin<unknown>> & { id: string }): Plugin<unknown> =>
  ({ version: '1.0.0', scope: 'bot', ...p }) as Plugin<unknown>;

const buildHost = (plugins: readonly Plugin<unknown>[]): LifecycleHost => {
  const registered = new Map<PluginId, RegisteredPlugin>();
  for (const p of plugins) registered.set(p.id, { plugin: p, config: undefined });
  const order = plugins.map((p) => p.id);
  const dependents = buildDependentsIndex(registered);
  return {
    registered,
    order,
    disabled: new Map<PluginId, DisabledPlugin>(),
    dependents,
    resolve: (() => {
      throw new Error('not used');
    }) as LifecycleHost['resolve'],
    container: createContainer(),
    dispatcher: new EventDispatcher(silent),
    logger: silent,
    translator: fakeTranslator,
    clock: systemClock,
  };
};

describe('PluginLifecycleRunner', () => {
  it('runs init / start / onReady hooks in topological order', async () => {
    const calls: string[] = [];
    const host = buildHost([
      plugin({
        id: 'a',
        init: async () => void calls.push('a.init'),
        start: async () => void calls.push('a.start'),
        onReady: async () => void calls.push('a.ready'),
      }),
      plugin({
        id: 'b',
        init: async () => void calls.push('b.init'),
      }),
    ]);
    const runner = new PluginLifecycleRunner(host);
    await runner.runInit();
    await runner.runStart();
    await runner.runReady();
    expect(calls).toEqual(['a.init', 'b.init', 'a.start', 'a.ready']);
  });

  it('disables a non-critical plugin that throws and continues the phase', async () => {
    const calls: string[] = [];
    const host = buildHost([
      plugin({
        id: 'a',
        init: async () => {
          throw new Error('boom');
        },
      }),
      plugin({ id: 'b', init: async () => void calls.push('b.init') }),
    ]);
    const runner = new PluginLifecycleRunner(host);
    await runner.runInit();
    expect(host.disabled.has('a')).toBe(true);
    expect(calls).toEqual(['b.init']);
  });

  it('cascade-disables dependents of a failed plugin', async () => {
    const host = buildHost([
      plugin({
        id: 'a',
        init: async () => {
          throw new Error('boom');
        },
      }),
      plugin({ id: 'b', dependencies: [{ id: 'a', versionRange: '*' }] }),
    ]);
    const runner = new PluginLifecycleRunner(host);
    await runner.runInit();
    expect(host.disabled.has('a')).toBe(true);
    expect(host.disabled.has('b')).toBe(true);
  });

  it('rethrows the first critical failure at the end of the phase', async () => {
    const host = buildHost([
      plugin({
        id: 'a',
        critical: true,
        init: async () => {
          throw new Error('critical boom');
        },
      }),
    ]);
    const runner = new PluginLifecycleRunner(host);
    await expect(runner.runInit()).rejects.toBeInstanceOf(CriticalPluginFailureError);
    expect(host.disabled.has('a')).toBe(true);
  });

  it('escalates a critical cascade victim into the rethrow', async () => {
    const host = buildHost([
      plugin({
        id: 'a',
        init: async () => {
          throw new Error('boom');
        },
      }),
      plugin({ id: 'b', critical: true, dependencies: [{ id: 'a', versionRange: '*' }] }),
    ]);
    const runner = new PluginLifecycleRunner(host);
    await expect(runner.runInit()).rejects.toBeInstanceOf(CriticalPluginFailureError);
  });

  it('runs onShutdown in reverse order and swallows shutdown failures', async () => {
    const calls: string[] = [];
    const host = buildHost([
      plugin({ id: 'a', onShutdown: async () => void calls.push('a.shutdown') }),
      plugin({
        id: 'b',
        onShutdown: async () => {
          throw new Error('shutdown boom');
        },
      }),
    ]);
    const runner = new PluginLifecycleRunner(host);
    await expect(runner.runShutdown()).resolves.toBeUndefined();
    expect(calls).toEqual(['a.shutdown']);
  });
});
