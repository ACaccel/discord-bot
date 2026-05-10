import OpenAI from 'openai';
import { LLMMessage, LLMProvider, LLMResult, LLMSettings } from './types';

export class OpenAIProvider implements LLMProvider {
    public readonly supportsWebSearch = true;

    private readonly client: OpenAI;

    public constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    public async chat(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
        if (settings.webSearch) {
            return this.chatWithWebSearch(messages, settings);
        }
        return this.chatStandard(messages, settings);
    }

    private async chatStandard(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
        const response = await this.client.chat.completions.create({
            model: settings.model,
            temperature: settings.temperature,
            messages: [
                ...(settings.systemPrompt ? [{ role: 'system' as const, content: settings.systemPrompt }] : []),
                ...messages,
            ],
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error('OpenAIProvider.chat: empty response from OpenAI API');
        }
        const u = response.usage;
        return {
            content,
            usage: u ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens } : null,
        };
    }

    private async chatWithWebSearch(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
        // Responses API supports web_search_preview tool
        const inputMessages: OpenAI.Responses.EasyInputMessage[] = [
            ...(settings.systemPrompt
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
        if (!content) {
            throw new Error('OpenAIProvider.chat: empty response from OpenAI Responses API');
        }
        const u = response.usage;
        return {
            content,
            usage: u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens } : null,
        };
    }
}
