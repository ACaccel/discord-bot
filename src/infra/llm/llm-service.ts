/**
 * LLMService — Strategy dispatcher over a {@link LlmProviderRegistry}.
 *
 * Responsibility split: the registry owns provider lookup / lifetime;
 * the service owns the per-call contract (web-search compatibility
 * check, call delegation). Plugin / handler code depends only on this
 * class via DI — never on a concrete provider — so swapping a provider
 * (or adding a new one) does not ripple beyond the registry.
 *
 * `chat()` returns `Result<LLMResult, LlmProviderError>`. Both expected
 * failure modes (the registry's missing-key gate, and the upstream SDK
 * / HTTP failures already typed by `error-translator.ts`) flow through
 * the typed error channel. Programmer errors (e.g. asking for a
 * web-search-capable model from a provider that lacks the capability)
 * stay as thrown native errors — the Result contract is for recoverable
 * boundary failures only.
 *
 * Provider resolution goes through `registry.tryResolve`, which returns
 * a Result-shaped value carrying an already-translated
 * `LlmProviderError`, so this method short-circuits on the missing-key
 * path with a clean Result branch.
 */
import { LlmProviderError } from '../../core/errors';
import { err, ok, type Result } from '../../core/result';
import type { LlmProviderRegistry } from './registry';
import type { LLMMessage, LLMResult, LLMSettings } from './types';
import { PROVIDER_API_KEY_ENV } from './types';

/**
 * Widened LlmProviderError that erases the params-shape generic so the
 * `chat()` return type stays a single concrete type regardless of
 * which translation branch produced it. Handlers read `messageKey` and
 * `messageParams` as an untyped i18n bag — the per-translator narrowing
 * doesn't survive past the boundary anyway.
 */
type AnyLlmProviderError = LlmProviderError<Readonly<Record<string, string | number>>>;

const unknownToLlmError = (e: unknown, provider: string): AnyLlmProviderError => {
  const message = e instanceof Error ? e.message : String(e);
  return new LlmProviderError({
    code: 'LLM_UNKNOWN',
    messageKey: 'errors:llm.unknown',
    messageParams: { provider },
    context: { operation: 'LLMService.chat', detail: message },
    cause: e,
  }) as AnyLlmProviderError;
};

export class LLMService {
  public constructor(private readonly registry: LlmProviderRegistry) {}

  /**
   * Send a chat request. Returns a `Result` whose success carries the
   * provider's response and whose error is a {@link LlmProviderError}
   * already translated (by either `registry.tryResolve` for missing-key
   * gating, or by `error-translator.ts` inside each provider).
   *
   * Throws (does NOT use the Result channel) if the caller asks for
   * web search on a provider that does not support it — that is a
   * programmer error the UI should have prevented and signals a bug,
   * not a runtime failure.
   */
  public async chat(
    messages: readonly LLMMessage[],
    settings: LLMSettings,
  ): Promise<Result<LLMResult, AnyLlmProviderError>> {
    const resolveResult = this.registry.tryResolve(settings.provider);
    if (!resolveResult.ok) return resolveResult;
    const provider = resolveResult.value;

    if (settings.webSearch && !provider.supportsWebSearch) {
      throw new Error(
        `LLMService.chat: provider "${settings.provider}" does not support web search`,
      );
    }

    try {
      const result = await provider.chat(messages, settings);
      return ok(result);
    } catch (e) {
      if (e instanceof LlmProviderError) {
        return err(e as AnyLlmProviderError);
      }
      // The provider contract (types.ts:55) requires translation to
      // LlmProviderError. A raw escape here is a contract violation
      // worth recording so the gap is visible in logs; wrap defensively
      // rather than re-throw so handlers stay on the Result path.
      return err(unknownToLlmError(e, settings.provider));
    }
  }
}

// Re-export so plugin/llm-chat keeps importing `PROVIDER_API_KEY_ENV`
// (and friends) from a single entry without splitting the surface.
export { PROVIDER_API_KEY_ENV };
