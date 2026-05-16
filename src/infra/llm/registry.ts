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
 * throughout `infra/llm`.
 *
 * PR-E E-6 (B-3 reviewer follow-up): two-shape resolution. `tryResolve`
 * returns `Result<LLMProvider, LlmProviderError>` for the recoverable
 * missing-key path so `LLMService` can stay on the Result rail end-
 * to-end. `resolve` keeps the throwing shape for callers that
 * already handle `MissingApiKeyError` (test fixtures, anything that
 * predates the Result contract).
 *
 * Both shapes still throw a native `TypeError` for the unknown-provider
 * programmer error per the DomainError convention.
 *
 * Adding a new provider:
 *   1. Implement {@link LLMProvider}.
 *   2. Append the name to {@link LLMProviderName} in `./types`.
 *   3. Pass its API-key value in the `apiKeys` map at the call site.
 *   4. Add one line to {@link createDefaultRegistry} below.
 */
import { LlmProviderError } from '../../core/errors';
import { err, ok, type Result } from '../../core/result';
import {
  MissingApiKeyError,
  PROVIDER_API_KEY_ENV,
  type LLMProvider,
  type LLMProviderName,
} from './types';

export type LlmProviderFactory = () => LLMProvider;

/** Pre-resolved per-provider API keys. `undefined` = unset / unused. */
export type LlmProviderApiKeys = Readonly<Partial<Record<LLMProviderName, string | undefined>>>;

/**
 * Widened LlmProviderError used as the Err branch of {@link tryResolve}.
 * Erases the messageParams generic so consumers handle a single
 * concrete type regardless of which translation branch produced it.
 */
type AnyLlmProviderError = LlmProviderError<Readonly<Record<string, string | number>>>;

const missingApiKeyToLlmError = (provider: LLMProviderName, envVar: string): AnyLlmProviderError =>
  new LlmProviderError({
    code: 'LLM_INVALID_API_KEY',
    messageKey: 'errors:llm.invalid_api_key',
    messageParams: { provider, envVar },
    context: { operation: 'LlmProviderRegistry.tryResolve' },
    cause: new MissingApiKeyError(provider, envVar),
  }) as AnyLlmProviderError;

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
   * the provider's API key is empty / unset; throws a native
   * `TypeError` if the name is not registered. Prefer
   * {@link tryResolve} for new code so the missing-key path stays
   * on the Result rail.
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

  /**
   * Result-shaped resolution. Returns `Ok(LLMProvider)` on success,
   * `Err(LlmProviderError)` for the recoverable missing-key path
   * (already translated through the i18n catalog). Throws `TypeError`
   * only for the programmer-error case (unknown provider name) — a
   * domain that is genuinely uncatchable.
   */
  public tryResolve(name: LLMProviderName): Result<LLMProvider, AnyLlmProviderError> {
    const cached = this.instances.get(name);
    if (cached !== undefined) return ok(cached);

    const keyValue = this.apiKeys[name];
    if (keyValue === undefined || keyValue.length === 0) {
      return err(missingApiKeyToLlmError(name, PROVIDER_API_KEY_ENV[name]));
    }

    const factory = this.factories.get(name);
    if (factory === undefined) {
      throw new TypeError(`LlmProviderRegistry.tryResolve: unknown provider "${name}"`);
    }
    const instance = factory();
    this.instances.set(name, instance);
    return ok(instance);
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
