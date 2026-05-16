/**
 * LlmProviderRegistry — Strategy lookup keyed by provider name.
 *
 * The registry holds *factories* rather than instances so a deployment
 * that only configures one provider's API key does not crash at
 * startup when other providers' SDKs reject the missing credentials.
 * Construction is deferred to first use; the registry caches the
 * instance after that.
 *
 * Phase 6 PR 2 changed the API-key sourcing path. Previously the
 * registry read `process.env[PROVIDER_API_KEY_ENV[name]]` directly
 * with an `eslint-disable no-restricted-syntax`. Now it takes a
 * pre-resolved `apiKeys` map (populated by the composition root from
 * the typed `Env`), so the strict env-access rule is honoured
 * throughout `infra/llm`. The `MissingApiKeyError` gate semantics are
 * unchanged: an empty / undefined key on a requested provider throws.
 *
 * Adding a new provider:
 *   1. Implement {@link LLMProvider}.
 *   2. Append the name to {@link LLMProviderName} in `./types`.
 *   3. Pass its API-key value in the `apiKeys` map at the call site.
 *   4. Add one line to {@link createDefaultRegistry} below.
 */
import {
  MissingApiKeyError,
  PROVIDER_API_KEY_ENV,
  type LLMProvider,
  type LLMProviderName,
} from './types';

export type LlmProviderFactory = () => LLMProvider;

/** Pre-resolved per-provider API keys. `undefined` = unset / unused. */
export type LlmProviderApiKeys = Readonly<Partial<Record<LLMProviderName, string | undefined>>>;

export class LlmProviderRegistry {
  private readonly factories: Map<LLMProviderName, LlmProviderFactory>;
  private readonly apiKeys: LlmProviderApiKeys;
  private readonly instances = new Map<LLMProviderName, LLMProvider>();

  public constructor(
    factories: Iterable<readonly [LLMProviderName, LlmProviderFactory]>,
    apiKeys: LlmProviderApiKeys = {},
  ) {
    this.factories = new Map(factories);
    this.apiKeys = apiKeys;
  }

  /**
   * Resolve a provider by name. Throws {@link MissingApiKeyError} if
   * the provider's API key is empty / unset (callers see the env-var
   * name in the error message so ops can locate the missing setting).
   * Throws a plain `Error` if the name is not registered.
   */
  public resolve(name: LLMProviderName): LLMProvider {
    const cached = this.instances.get(name);
    if (cached !== undefined) return cached;

    const keyValue = this.apiKeys[name];
    if (keyValue === undefined || keyValue.length === 0) {
      throw new MissingApiKeyError(name, PROVIDER_API_KEY_ENV[name]);
    }

    const factory = this.factories.get(name);
    if (factory === undefined) {
      // Programmer error: a hard-coded LLMProviderName slipped past the
      // registry's known set. Native TypeError per the DomainError
      // convention ("DomainError is for expected failure modes only").
      throw new TypeError(`LlmProviderRegistry.resolve: unknown provider "${name}"`);
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
