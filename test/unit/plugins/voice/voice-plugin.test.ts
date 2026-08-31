/**
 * VoicePlugin DI smoke test. Verifies that the plugin's `init`
 * hook publishes its `VoiceController` under `TOKENS.VoiceController`
 * through the `registerInstance` facade so consumers (BaseBot's
 * `voice` getter, the record handler) can resolve it from the
 * container.
 *
 * We exercise the runner directly rather than spinning a full
 * `PluginHost` — the host wires nothing voice-specific, so a smaller
 * harness keeps the test focused on the DI contract.
 */
import { describe, expect, it } from 'vitest';
import type { Client } from 'discord.js';

import { createContainer } from '../../../../src/core/ioc';
import { TOKENS } from '../../../../src/bot/tokens';
import { createLogger } from '../../../../src/core/logger';
import { EventDispatcher } from '../../../../src/core/plugin/event-dispatcher';
import {
  PluginLifecycleRunner,
  type LifecycleHost,
  type RegisteredPlugin,
} from '../../../../src/core/plugin/host/lifecycle';
import type { DisabledPlugin, Plugin, PluginId } from '../../../../src/core/plugin/types';
import { systemClock } from '../../../../src/core/time';
import { createVoicePlugin, VoiceController } from '../../../../src/plugins/voice/plugin';

const silent = createLogger({ level: 'silent', pretty: false });
const fakeTranslator = { t: (k: string) => k } as LifecycleHost['translator'];

describe('VoicePlugin', () => {
  it('publishes VoiceController under TOKENS.VoiceController during init', async () => {
    const container = createContainer();
    // The VoiceController constructor only stores the client and lazily
    // creates a `VoiceRecorder`; the recorder itself does not touch the
    // client at construction time. Cast a minimal stub through unknown
    // so we do not have to mirror the full `Client` surface.
    const fakeClient = {} as unknown as Client;
    container.registerSingleton(TOKENS.DiscordClient, () => fakeClient);

    const plugin = createVoicePlugin() as Plugin;
    const registered = new Map<PluginId, RegisteredPlugin>([[plugin.id, { plugin }]]);
    const host: LifecycleHost = {
      registered,
      disabled: new Map<PluginId, DisabledPlugin>(),
      resolve: container.resolve.bind(container),
      container,
      dispatcher: new EventDispatcher(silent),
      logger: silent,
      translator: fakeTranslator,
      clock: systemClock,
    };

    const runner = new PluginLifecycleRunner(host);
    await runner.runInit();

    expect(host.disabled.size).toBe(0);
    const controller = container.resolve(TOKENS.VoiceController);
    expect(controller).toBeInstanceOf(VoiceController);
    // Resolving twice returns the same instance — singleton cache hit,
    // not a duplicate factory invocation.
    expect(container.resolve(TOKENS.VoiceController)).toBe(controller);
  });

  it('leaves TOKENS.VoiceController unbound when the plugin is not registered', () => {
    const container = createContainer();
    expect(container.tryResolve(TOKENS.VoiceController)).toBeUndefined();
  });
});
