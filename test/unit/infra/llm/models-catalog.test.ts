/**
 * ModelCatalog DI integration smoke test (R2).
 *
 * After R2 the catalog is no longer a module-scope holder — it is
 * built by `LlmChatPlugin.init` and published through
 * `ctx.registerInstance(TOKENS.ModelCatalog, ...)`. This test wires
 * the plugin against a real `PluginLifecycleRunner` + container,
 * stubs the typed Env, and asserts:
 *   - the container resolves a `ModelCatalog` after `runInit`;
 *   - bots that never register `LlmChatPlugin` resolve `undefined`,
 *     matching the `bot.modelCatalog` getter's contract.
 *
 * The catalog's HTTP-fetch behaviour is covered elsewhere; here we
 * only care about the DI hop because that is the surface R2 changed.
 */
import { describe, expect, it } from 'vitest';

import { createContainer, TOKENS } from '../../../../src/core/ioc';
import { createLogger } from '../../../../src/core/logger';
import { EventDispatcher } from '../../../../src/core/plugin/event-dispatcher';
import {
  PluginLifecycleRunner,
  type LifecycleHost,
  type RegisteredPlugin,
} from '../../../../src/core/plugin/host/lifecycle';
import { buildDependentsIndex } from '../../../../src/core/plugin/host/topology';
import type { DisabledPlugin, Plugin, PluginId } from '../../../../src/core/plugin/types';
import { systemClock } from '../../../../src/core/time';
import { ModelCatalog } from '../../../../src/infra/llm/models-catalog';
import { createLlmChatPlugin } from '../../../../src/plugins/llm-chat';

const silent = createLogger({ level: 'silent', pretty: false });
const fakeTranslator = { t: (k: string) => k } as LifecycleHost['translator'];

interface PartialEnv {
  readonly XAI_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly GEMINI_API_KEY?: string;
}

const stubEnv: PartialEnv = {
  XAI_API_KEY: 'sk-test-xai',
  OPENAI_API_KEY: 'sk-test-openai',
  ANTHROPIC_API_KEY: 'sk-test-anthropic',
  GEMINI_API_KEY: 'sk-test-gemini',
};

describe('ModelCatalog DI wiring (R2)', () => {
  it('LlmChatPlugin.init registers a ModelCatalog the container can resolve', async () => {
    const container = createContainer();
    // The plugin only reads the four provider API keys off the typed
    // Env. Cast a minimal stub through unknown so we do not have to
    // synthesise the full schema.
    container.registerSingleton(TOKENS.Env, () => stubEnv as unknown as never);

    const plugin = createLlmChatPlugin({ clientId: 'bot-1' }) as Plugin<unknown>;
    const registered = new Map<PluginId, RegisteredPlugin>([
      [plugin.id, { plugin, config: undefined }],
    ]);
    const host: LifecycleHost = {
      registered,
      order: [plugin.id],
      disabled: new Map<PluginId, DisabledPlugin>(),
      dependents: buildDependentsIndex(registered),
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
    const catalog = container.resolve(TOKENS.ModelCatalog);
    expect(catalog).toBeInstanceOf(ModelCatalog);
    // Cache miss returns an empty array (the synchronous contract the
    // `/ai_settings` modal builder depends on); we only check the
    // shape, not the contents.
    expect(Array.isArray(catalog.list('openai'))).toBe(true);
  });

  it('leaves TOKENS.ModelCatalog unbound when LlmChatPlugin is not registered', () => {
    const container = createContainer();
    expect(container.tryResolve(TOKENS.ModelCatalog)).toBeUndefined();
  });
});
