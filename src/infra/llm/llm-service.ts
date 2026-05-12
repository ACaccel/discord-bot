/**
 * LLMService — Strategy dispatcher over a {@link LlmProviderRegistry}.
 *
 * Phase 5 split: the registry owns provider lookup / lifetime; the
 * service owns the per-call contract (web-search compatibility check,
 * call delegation). Plugin / handler code depends only on this class
 * via DI — never on a concrete provider — so swapping a provider
 * (or adding a new one) does not ripple beyond the registry.
 */
import type { LlmProviderRegistry } from './registry';
import type { LLMMessage, LLMResult, LLMSettings } from './types';

export class LLMService {
  public constructor(private readonly registry: LlmProviderRegistry) {}

  /**
   * Send a chat request. Throws if the chosen provider does not
   * support web search but `webSearch` is true (programmer error —
   * the UI should not expose web search for providers that lack it).
   * SDK / HTTP failures arrive here as
   * {@link import('../../core/errors').LlmProviderError}.
   */
  public async chat(messages: readonly LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
    const provider = this.registry.resolve(settings.provider);
    if (settings.webSearch && !provider.supportsWebSearch) {
      throw new Error(
        `LLMService.chat: provider "${settings.provider}" does not support web search`,
      );
    }
    return provider.chat(messages, settings);
  }
}
