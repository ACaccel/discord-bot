/**
 * OpenAI LLM provider adapter.
 *
 * Wraps the official `openai` SDK in our {@link LLMProvider} Strategy
 * shape. Two endpoints:
 *   - `/v1/chat/completions` for plain chat;
 *   - `/v1/responses` with the `web_search_preview` tool when the
 *     caller enables web search.
 *
 * Every SDK throw is funnelled through {@link translateProviderError}
 * so callers see a typed {@link LlmProviderError} sub-code rather
 * than a generic SDK exception. Contract tests in
 * `test/contract/llm/openai.contract.test.ts` pin the translation.
 */
import OpenAI from 'openai';

import { translateProviderError } from './error-translator';
import type { LLMMessage, LLMProvider, LLMResult, LLMSettings } from './types';

const OPERATION = 'OpenAIProvider.chat';

export class OpenAIProvider implements LLMProvider {
  public readonly supportsWebSearch = true;

  private readonly client: OpenAI;

  public constructor(client?: OpenAI) {
    // `client` injection point exists so contract tests can pass a
    // pre-configured instance with a custom `baseURL` (the nock
    // interceptor binds to whatever host the test sets).
    this.client =
      client ??
      new OpenAI({
        // TODO(phase-6): move LLM keys into typed Env (`src/core/config`).
        // The registry's missing-key gate at `resolve()` already validates
        // the value before this constructor runs.
        // eslint-disable-next-line no-restricted-syntax
        apiKey: process.env['OPENAI_API_KEY'],
      });
  }

  public async chat(messages: readonly LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
    try {
      if (settings.webSearch) {
        return await this.chatWithWebSearch(messages, settings);
      }
      return await this.chatStandard(messages, settings);
    } catch (err: unknown) {
      throw translateProviderError('openai', OPERATION, err);
    }
  }

  private async chatStandard(
    messages: readonly LLMMessage[],
    settings: LLMSettings,
  ): Promise<LLMResult> {
    const response = await this.client.chat.completions.create({
      model: settings.model,
      temperature: settings.temperature,
      messages: [
        ...(settings.systemPrompt.length > 0
          ? [{ role: 'system' as const, content: settings.systemPrompt }]
          : []),
        ...messages,
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (content === null || content === undefined || content.length === 0) {
      throw new Error('OpenAIProvider.chat: empty response from OpenAI Chat Completions API');
    }
    const u = response.usage;
    return {
      content,
      usage:
        u === null || u === undefined
          ? null
          : { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens },
    };
  }

  private async chatWithWebSearch(
    messages: readonly LLMMessage[],
    settings: LLMSettings,
  ): Promise<LLMResult> {
    const inputMessages: OpenAI.Responses.EasyInputMessage[] = [
      ...(settings.systemPrompt.length > 0
        ? [{ role: 'system' as const, content: settings.systemPrompt }]
        : []),
      ...messages,
    ];
    const response = await this.client.responses.create({
      model: settings.model,
      temperature: settings.temperature,
      tools: [{ type: 'web_search_preview' }],
      input: inputMessages,
    });
    const content = response.output_text;
    if (content === null || content === undefined || content.length === 0) {
      throw new Error('OpenAIProvider.chat: empty response from OpenAI Responses API');
    }
    const u = response.usage;
    return {
      content,
      usage:
        u === null || u === undefined
          ? null
          : { inputTokens: u.input_tokens, outputTokens: u.output_tokens },
    };
  }
}
