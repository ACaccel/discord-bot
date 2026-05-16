/**
 * xAI Grok provider adapter.
 *
 * xAI exposes two endpoints behind one OpenAI-compatible client:
 *   - `/v1/chat/completions` — plain chat. Does NOT accept the new
 *     Agent Tools; the legacy `search_parameters` field returns
 *     HTTP 410 (deprecated).
 *   - `/v1/responses` — Agent Tools API. Server-side `web_search`
 *     runs inside xAI and merges into `output_text` automatically.
 *
 * Ref: https://docs.x.ai/docs/guides/tools/overview
 *
 * Errors funnel through {@link translateProviderError}.
 */
import OpenAI from 'openai';

import { emptyResponseError, translateProviderError } from './error-translator';
import type { LLMMessage, LLMProvider, LLMResult, LLMSettings } from './types';

const OPERATION = 'XAIProvider.chat';
const BASE_URL = 'https://api.x.ai/v1';

export class XAIProvider implements LLMProvider {
  public readonly supportsWebSearch = true;

  private readonly client: OpenAI;

  public constructor(apiKey?: string, client?: OpenAI) {
    this.client = client ?? new OpenAI({ apiKey, baseURL: BASE_URL });
  }

  public async chat(messages: readonly LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
    try {
      if (settings.webSearch) {
        return await this.chatWithWebSearch(messages, settings);
      }
      return await this.chatStandard(messages, settings);
    } catch (err: unknown) {
      throw translateProviderError('xai', OPERATION, err);
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
      throw emptyResponseError('xai', `${OPERATION}.chat_completions`);
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
    // xAI's Responses API accepts the OpenAI tool shape but uses the
    // bare `web_search` discriminator instead of `web_search_preview`.
    // The cast is the narrowest path through OpenAI's literal union.
    const response = await this.client.responses.create({
      model: settings.model,
      temperature: settings.temperature,
      tools: [{ type: 'web_search' as 'web_search_preview' }],
      input: inputMessages,
    });
    const content = response.output_text;
    if (content === null || content === undefined || content.length === 0) {
      throw emptyResponseError('xai', `${OPERATION}.responses`);
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
