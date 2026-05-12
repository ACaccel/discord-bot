import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../../../../src/core/logger';
import { systemClock } from '../../../../src/core/time';
import { createContainer, type ServiceContainer } from '../../../../src/core/ioc';
import {
  CriticalPluginFailureError,
  DuplicateContributionError,
  PluginHost,
  PluginRegistrationError,
  type Plugin,
  type PluginHostOptions,
} from '../../../../src/core/plugin';

const silent = createLogger({ level: 'silent', pretty: false });

const fakeTranslator = { t: (k: string) => k } as PluginHostOptions['translator'];

const buildHost = (
  overrides: Partial<PluginHostOptions> = {},
): {
  host: PluginHost;
  container: ServiceContainer;
} => {
  const container = createContainer();
  return {
    container,
    host: new PluginHost({
      container,
      logger: silent,
      translator: fakeTranslator,
      clock: systemClock,
      coreRegistries: {},
      ...overrides,
    }),
  };
};

const plugin = <C = void>(p: Partial<Plugin<C>> & { id: string }): Plugin<C> =>
  ({
    version: '1.0.0',
    scope: 'bot',
    ...p,
  }) as Plugin<C>;

describe('PluginHost.register', () => {
  it('rejects duplicate plugin ids', () => {
    const { host } = buildHost();
    host.register(plugin({ id: 'a' }));
    expect(() => host.register(plugin({ id: 'a' }))).toThrowError(PluginRegistrationError);
  });

  it('rejects unsupported guild-scoped plugins until Phase 4b', () => {
    const { host } = buildHost();
    try {
      host.register(plugin({ id: 'g', scope: 'guild' }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PluginRegistrationError);
      expect((e as PluginRegistrationError).reason).toBe('UNSUPPORTED_SCOPE');
    }
  });

  it('validates raw config against the plugin configSchema', () => {
    const { host } = buildHost();
    const schema = z.object({ threshold: z.number().int().min(0) });
    const p = plugin<{ threshold: number }>({ id: 'cfg', configSchema: schema });
    expect(() => host.register(p, { threshold: 'oops' })).toThrowError(PluginRegistrationError);
  });

  it('accepts plugins with a missing schema by passing rawConfig through', () => {
    const { host } = buildHost();
    expect(() => host.register(plugin({ id: 'no-schema' }), { whatever: 1 })).not.toThrow();
  });
});

describe('PluginHost.finalizeRegistration', () => {
  it('throws on missing dependency', () => {
    const { host } = buildHost();
    host.register(plugin({ id: 'a', dependencies: [{ id: 'missing', versionRange: '*' }] }));
    try {
      host.finalizeRegistration();
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PluginRegistrationError);
      expect((e as PluginRegistrationError).reason).toBe('MISSING_DEPENDENCY');
    }
  });

  it('throws on circular dependency', () => {
    const { host } = buildHost();
    host.register(plugin({ id: 'a', dependencies: [{ id: 'b', versionRange: '*' }] }));
    host.register(plugin({ id: 'b', dependencies: [{ id: 'a', versionRange: '*' }] }));
    try {
      host.finalizeRegistration();
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PluginRegistrationError);
      expect((e as PluginRegistrationError).reason).toBe('CIRCULAR_DEPENDENCY');
    }
  });

  it('returns a topological order with deps before dependents', () => {
    const { host } = buildHost();
    // Register in arbitrary order; topo sort fixes it.
    host.register(plugin({ id: 'logger' }));
    host.register(
      plugin({
        id: 'app',
        dependencies: [
          { id: 'logger', versionRange: '*' },
          { id: 'repos', versionRange: '*' },
        ],
      }),
    );
    host.register(plugin({ id: 'repos', dependencies: [{ id: 'logger', versionRange: '*' }] }));
    host.finalizeRegistration();
    const order = host.getOrder();
    expect(order.indexOf('logger')).toBeLessThan(order.indexOf('repos'));
    expect(order.indexOf('repos')).toBeLessThan(order.indexOf('app'));
    expect(order.indexOf('logger')).toBeLessThan(order.indexOf('app'));
  });
});

describe('PluginHost.buildEffectiveRegistries', () => {
  class CmdCore {}
  class CmdPlugin {}

  it('merges core registries with plugin contributions', () => {
    const { host } = buildHost({
      coreRegistries: { commands: { coreCmd: CmdCore } },
    });
    host.register(
      plugin({
        id: 'p',
        contributes: { commands: { pluginCmd: CmdPlugin } },
      }),
    );
    host.finalizeRegistration();
    const eff = host.buildEffectiveRegistries();
    expect(eff.commands).toEqual({ coreCmd: CmdCore, pluginCmd: CmdPlugin });
  });

  it('throws DuplicateContributionError when core and plugin collide on the same name', () => {
    const { host } = buildHost({
      coreRegistries: { commands: { ping: CmdCore } },
    });
    host.register(
      plugin({
        id: 'p',
        contributes: { commands: { ping: CmdPlugin } },
      }),
    );
    host.finalizeRegistration();
    expect(() => host.buildEffectiveRegistries()).toThrowError(DuplicateContributionError);
  });

  it('throws DuplicateContributionError when two plugins collide', () => {
    const { host } = buildHost();
    host.register(plugin({ id: 'a', contributes: { commands: { dup: CmdCore } } }));
    host.register(plugin({ id: 'b', contributes: { commands: { dup: CmdPlugin } } }));
    host.finalizeRegistration();
    expect(() => host.buildEffectiveRegistries()).toThrowError(DuplicateContributionError);
  });

  it('caches the result — second call returns the same object reference', () => {
    const { host } = buildHost();
    host.register(plugin({ id: 'a', contributes: { commands: { foo: CmdCore } } }));
    host.finalizeRegistration();
    const first = host.buildEffectiveRegistries();
    const second = host.buildEffectiveRegistries();
    expect(first).toBe(second);
  });
});

describe('PluginHost lifecycle', () => {
  it('invokes init -> start -> onReady in topological order', async () => {
    const log: string[] = [];
    const make = (id: string, deps: string[] = []) =>
      plugin({
        id,
        dependencies: deps.map((d) => ({ id: d, versionRange: '*' })),
        init: async () => {
          log.push(`${id}:init`);
        },
        start: async () => {
          log.push(`${id}:start`);
        },
        onReady: async () => {
          log.push(`${id}:ready`);
        },
      });
    const { host } = buildHost();
    host.register(make('app', ['logger']));
    host.register(make('logger'));
    host.finalizeRegistration();
    await host.initAll();
    await host.startAll();
    await host.readyAll();
    expect(log).toEqual([
      'logger:init',
      'app:init',
      'logger:start',
      'app:start',
      'logger:ready',
      'app:ready',
    ]);
  });

  it('disables a non-critical plugin when its init throws; siblings continue', async () => {
    const okStart = vi.fn(async () => undefined);
    const { host } = buildHost();
    host.register(
      plugin({
        id: 'boom',
        init: async () => {
          throw new Error('init failed');
        },
        start: async () => {
          throw new Error('start should never run on disabled plugin');
        },
      }),
    );
    host.register(plugin({ id: 'ok', start: okStart }));
    host.finalizeRegistration();
    await host.initAll();
    await host.startAll();
    const disabled = host.getDisabledPlugins();
    expect(disabled.map((d) => d.id)).toEqual(['boom']);
    expect(disabled[0]?.phase).toBe('init');
    expect(okStart).toHaveBeenCalledTimes(1);
  });

  it('rethrows CriticalPluginFailureError for critical plugins that fail in init', async () => {
    const { host } = buildHost();
    host.register(
      plugin({
        id: 'fatal',
        critical: true,
        init: async () => {
          throw new Error('cant start');
        },
      }),
    );
    host.finalizeRegistration();
    await expect(host.initAll()).rejects.toBeInstanceOf(CriticalPluginFailureError);
    // Still marked disabled for the diagnostic surface.
    expect(host.getDisabledPlugins().map((d) => d.id)).toEqual(['fatal']);
  });

  it('runs onShutdown in reverse topological order; failures are non-fatal', async () => {
    const log: string[] = [];
    const make = (id: string, deps: string[] = [], shutdownThrows = false) =>
      plugin({
        id,
        dependencies: deps.map((d) => ({ id: d, versionRange: '*' })),
        onShutdown: async () => {
          log.push(`${id}:down`);
          if (shutdownThrows) throw new Error('shutdown threw');
        },
      });
    const { host } = buildHost();
    host.register(make('app', ['repos']));
    host.register(make('repos', ['logger']));
    host.register(make('logger', [], /* shutdownThrows */ true));
    host.finalizeRegistration();
    await host.shutdownAll();
    expect(log).toEqual(['app:down', 'repos:down', 'logger:down']);
  });

  it('attaches event subscriptions after startAll() and unsubscribes on shutdown', async () => {
    const handler = vi.fn(async () => undefined);
    const { host } = buildHost();
    host.register(
      plugin({
        id: 'evt',
        events: { messageCreate: handler },
      }),
    );
    host.finalizeRegistration();
    await host.initAll();
    await host.startAll();
    const dispatcher = host.getEventDispatcher();
    expect(dispatcher.listenerCount('messageCreate')).toBe(1);
    await dispatcher.emit('messageCreate', {} as never);
    expect(handler).toHaveBeenCalledTimes(1);
    await host.shutdownAll();
    expect(dispatcher.listenerCount('messageCreate')).toBe(0);
  });

  it('does NOT subscribe events for a plugin disabled in init', async () => {
    const handler = vi.fn(async () => undefined);
    const { host } = buildHost();
    host.register(
      plugin({
        id: 'broken',
        init: async () => {
          throw new Error('init oops');
        },
        events: { messageCreate: handler },
      }),
    );
    host.finalizeRegistration();
    await host.initAll();
    await host.startAll();
    expect(host.getEventDispatcher().listenerCount('messageCreate')).toBe(0);
  });
});
