/**
 * LlmProviderRegistry — Strategy lookup keyed by provider name.
 *
 * The registry holds *factories* rather than instances so a deployment
 * that only configures one provider's API key does not crash at
 * startup when other providers' SDKs reject the missing credentials.
 * Construction is deferred to first use; the registry caches the
 * instance after that.
 *
 * Adding a new provider:
 *   1. Implement {@link LLMProvider} (see existing providers under
 *      `src/infra/llm/`).
 *   2. Append the name to {@link LLMProviderName} in `./types`.
 *   3. Add one line to {@link defaultProviderRegistry} below.
 *
 * Tests get an isolated registry via `new LlmProviderRegistry(map)`
 * so they can substitute fakes without monkey-patching modules.
 */
import {
  MissingApiKeyError,
  PROVIDER_API_KEY_ENV,
  type LLMProvider,
  type LLMProviderName,
} from './types';

export type LlmProviderFactory = () => LLMProvider;

export class LlmProviderRegistry {
  private readonly factories: Map<LLMProviderName, LlmProviderFactory>;
  private readonly instances = new Map<LLMProviderName, LLMProvider>();

  public constructor(factories: Iterable<readonly [LLMProviderName, LlmProviderFactory]>) {
    this.factories = new Map(factories);
  }

  /**
   * Resolve a provider by name. Throws {@link MissingApiKeyError} if
   * the provider's env-var-backed API key is empty / unset — the
   * factory never runs, so the upstream SDK does not see a half-built
   * credential. Throws a plain `Error` if the name is not registered.
   */
  public resolve(name: LLMProviderName): LLMProvider {
    const cached = this.instances.get(name);
    if (cached !== undefined) return cached;

    const envVar = PROVIDER_API_KEY_ENV[name];
    // TODO(phase-6): move LLM keys into typed Env (`src/core/config`).
    // This gate is the only place we need to introspect dynamic env-var
    // names; once the typed Env carries the keys this becomes a typed
    // lookup and the eslint-disable drops away.
    // eslint-disable-next-line no-restricted-syntax
    const keyValue = envVar.length > 0 ? process.env[envVar] : undefined;
    if (keyValue === undefined || keyValue.length === 0) {
      throw new MissingApiKeyError(name, envVar);
    }

    const factory = this.factories.get(name);
    if (factory === undefined) {
      throw new Error(`LlmProviderRegistry.resolve: unknown provider "${name}"`);
    }
    const instance = factory();
    this.instances.set(name, instance);
    return instance;
  }

  /** True if the provider is registered (regardless of whether its key is set). */
  public has(name: LLMProviderName): boolean {
    return this.factories.has(name);
  }

  /** Snapshot of every registered provider name. */
  public names(): readonly LLMProviderName[] {
    return [...this.factories.keys()];
  }
}
