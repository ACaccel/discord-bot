import OpenAI from 'openai';
import { LLMMessage, LLMProvider, LLMResult, LLMSettings } from './types';

/**
 * xAI Grok provider. xAI exposes two endpoints behind one OpenAI-compatible client:
 *
 *   - `/v1/chat/completions` — used for plain chat. Does NOT support the new
 *     Agent Tools (`web_search`, etc.); the legacy `search_parameters` field
 *     here returns HTTP 410 (deprecated).
 *   - `/v1/responses` — Agent Tools API. Server-side `web_search` tool runs
 *     inside xAI and the result is merged into `output_text` automatically.
 *
 * Ref: https://docs.x.ai/docs/guides/tools/overview
 */
export class XAIProvider implements LLMProvider {
    public readonly supportsWebSearch = true;

    private readonly client: OpenAI;

    public constructor() {
        this.client = new OpenAI({
            apiKey: process.env.XAI_API_KEY,
            baseURL: 'https://api.x.ai/v1',
        });
    }

    public async chat(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
        if (settings.webSearch) {
            return this.chatWithWebSearch(messages, settings);
        }
        return this.chatStandard(messages, settings);
    }

    private async chatStandard(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
        const params: Record<string, unknown> = {
            model: settings.model,
            temperature: settings.temperature,
            messages: [
                ...(settings.systemPrompt ? [{ role: 'system', content: settings.systemPrompt }] : []),
                ...messages,
            ],
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (this.client.chat.completions.create as any)(params);
        const content = response?.choices?.[0]?.message?.content as string | undefined;
        if (!content) {
            throw new Error('XAIProvider.chat: empty response from xAI Chat Completions API');
        }
        const u = response?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
        return {
            content,
            usage:
                u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
                    ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens }
                    : null,
        };
    }

    private async chatWithWebSearch(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
        const inputMessages: OpenAI.Responses.EasyInputMessage[] = [
            ...(settings.systemPrompt
                ? [{ role: 'system' as const, content: settings.systemPrompt }]
                : []),
            ...messages,
        ];

        const response = await this.client.responses.create({
            model: settings.model,
            temperature: settings.temperature,
            tools: [{ type: 'web_search' as 'web_search_preview' }],
            input: inputMessages,
        });

        const content = response.output_text;
        if (!content) {
            throw new Error('XAIProvider.chat: empty response from xAI Responses API');
        }
        const u = response.usage;
        return {
            content,
            usage: u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens } : null,
        };
    }
}
