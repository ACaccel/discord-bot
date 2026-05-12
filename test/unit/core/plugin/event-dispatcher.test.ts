import { describe, expect, it, vi } from 'vitest';
import { EventDispatcher } from '../../../../src/core/plugin/event-dispatcher';
import { createLogger } from '../../../../src/core/logger';
import { systemClock } from '../../../../src/core/time';
import { createContainer } from '../../../../src/core/ioc';
import type { PluginRuntimeServices } from '../../../../src/core/plugin';

const silent = createLogger({ level: 'silent', pretty: false });

const services = (): PluginRuntimeServices => {
  // One container per call — `bind` target must match the method
  // owner. Tests never exercise resolve, but the wiring is still
  // shape-correct.
  const container = createContainer();
  return {
    logger: silent,
    translator: { t: (k: string) => k } as PluginRuntimeServices['translator'],
    clock: systemClock,
    resolve: container.resolve.bind(container) as PluginRuntimeServices['resolve'],
  };
};

describe('EventDispatcher', () => {
  it('fans an event out to every subscriber once', async () => {
    const aFn = vi.fn(async () => undefined);
    const bFn = vi.fn(async () => undefined);
    const dispatcher = new EventDispatcher(silent);
    dispatcher.subscribe('pluginA', services(), { messageCreate: aFn });
    dispatcher.subscribe('pluginB', services(), { messageCreate: bFn });

    await dispatcher.emit('messageCreate', { content: 'hi' } as never);
    expect(aFn).toHaveBeenCalledTimes(1);
    expect(bFn).toHaveBeenCalledTimes(1);
  });

  it('isolates subscriber failures — one throw does not block siblings', async () => {
    const failing = vi.fn(async () => {
      throw new Error('A boom');
    });
    const ok = vi.fn(async () => undefined);
    const dispatcher = new EventDispatcher(silent);
    dispatcher.subscribe('pluginA', services(), { messageCreate: failing });
    dispatcher.subscribe('pluginB', services(), { messageCreate: ok });

    await dispatcher.emit('messageCreate', {} as never);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('does not throw out of emit() when a subscription rejects', async () => {
    const dispatcher = new EventDispatcher(silent);
    dispatcher.subscribe('pluginA', services(), {
      messageCreate: async () => {
        throw new Error('boom');
      },
    });
    await expect(dispatcher.emit('messageCreate', {} as never)).resolves.toBeUndefined();
  });

  it("reflects the plugin's scoped services as the subscription ctx", async () => {
    const dispatcher = new EventDispatcher(silent);
    let observedEventName: string | undefined;
    dispatcher.subscribe('p', services(), {
      ready: async (ctx) => {
        observedEventName = ctx.eventName;
      },
    });
    await dispatcher.emit('ready', {} as never);
    expect(observedEventName).toBe('ready');
  });

  it('unsubscribeAll removes every subscription owned by the plugin', async () => {
    const dispatcher = new EventDispatcher(silent);
    const stay = vi.fn(async () => undefined);
    const go = vi.fn(async () => undefined);
    dispatcher.subscribe('keep', services(), { messageCreate: stay });
    dispatcher.subscribe('drop', services(), { messageCreate: go });
    dispatcher.unsubscribeAll('drop');
    await dispatcher.emit('messageCreate', {} as never);
    expect(stay).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
    expect(dispatcher.listenerCount('messageCreate')).toBe(1);
  });

  it('emit() on an event with no subscribers is a quiet no-op', async () => {
    const dispatcher = new EventDispatcher(silent);
    await expect(dispatcher.emit('messageCreate', {} as never)).resolves.toBeUndefined();
  });
});
