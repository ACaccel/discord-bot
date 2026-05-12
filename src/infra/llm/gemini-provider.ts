/**
 * Gemini LLM provider adapter.
 *
 * Uses `@google/generative-ai`. The SDK's chat API takes a `history`
 * (everything but the most recent message) plus the last user
 * message. Errors funnel through {@link translateProviderError}.
 */
import { GoogleGenerativeAI, type Content, type Tool } from '@google/generative-ai';

import { translateProviderError } from './error-translator';
import type { LLMMessage, LLMProvider, LLMResult, LLMSettings } from './types';

const OPERATION = 'GeminiProvider.chat';

export class GeminiProvider implements LLMProvider {
  public readonly supportsWebSearch = true;

  private readonly client: GoogleGenerativeAI;

  public constructor(client?: GoogleGenerativeAI) {
    // TODO(phase-6): move LLM keys into typed Env (`src/core/config`).
    // eslint-disable-next-line no-restricted-syntax
    this.client = client ?? new GoogleGenerativeAI(process.env['GEMINI_API_KEY'] ?? '');
  }

  public async chat(messages: readonly LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
    try {
      const tools: Tool[] = settings.webSearch ? [{ googleSearch: {} } as unknown as Tool] : [];
      const model = this.client.getGenerativeModel({
        model: settings.model,
        ...(settings.systemPrompt.length > 0 ? { systemInstruction: settings.systemPrompt } : {}),
        generationConfig: { temperature: settings.temperature },
        ...(tools.length > 0 ? { tools } : {}),
      });

      const history: Content[] = messages.slice(0, -1).map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));
      const lastMessage = messages[messages.length - 1];
      if (lastMessage === undefined) {
        throw new Error('GeminiProvider.chat: no messages provided');
      }

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage.content);
      const text = result.response.text();
      if (text.length === 0) {
        throw new Error('GeminiProvider.chat: empty response from Gemini API');
      }
      const meta = result.response.usageMetadata;
      return {
        content: text,
        usage:
          meta === undefined
            ? null
            : {
                inputTokens: meta.promptTokenCount ?? 0,
                outputTokens: meta.candidatesTokenCount ?? 0,
              },
      };
    } catch (err: unknown) {
      throw translateProviderError('gemini', OPERATION, err);
    }
  }
}
