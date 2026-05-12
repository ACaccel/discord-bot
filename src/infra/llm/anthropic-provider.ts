/**
 * Anthropic LLM provider adapter.
 *
 * Uses the official `@anthropic-ai/sdk`. Web-search is supported via
 * the `web_search_20250305` tool. Errors funnel through
 * {@link translateProviderError} so 401 / 429 / 5xx / context-too-long
 * surface as typed {@link LlmProviderError} sub-codes.
 */
import Anthropic from '@anthropic-ai/sdk';

import { translateProviderError } from './error-translator';
import type { LLMMessage, LLMProvider, LLMResult, LLMSettings } from './types';

const OPERATION = 'AnthropicProvider.chat';
const MAX_TOKENS = 4096;

export class AnthropicProvider implements LLMProvider {
  public readonly supportsWebSearch = true;

  private readonly client: Anthropic;

  public constructor(apiKey?: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  public async chat(messages: readonly LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
    try {
      const tools = settings.webSearch
        ? ([
            {
              type: 'web_search_20250305',
              name: 'web_search',
            } as unknown as Anthropic.Tool,
          ] satisfies Anthropic.Tool[])
        : ([] satisfies Anthropic.Tool[]);
      const response = await this.client.messages.create({
        model: settings.model,
        max_tokens: MAX_TOKENS,
        temperature: settings.temperature,
        ...(settings.systemPrompt.length > 0 ? { system: settings.systemPrompt } : {}),
        messages: [...messages],
        ...(tools.length > 0 ? { tools } : {}),
      });
      // Extract text from the content blocks, ignoring tool-use blocks.
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (text.length === 0) {
        throw new Error('AnthropicProvider.chat: empty text response from Anthropic API');
      }
      const u = response.usage;
      return {
        content: text,
        usage:
          u === null || u === undefined
            ? null
            : { inputTokens: u.input_tokens, outputTokens: u.output_tokens },
      };
    } catch (err: unknown) {
      throw translateProviderError('anthropic', OPERATION, err);
    }
  }
}
