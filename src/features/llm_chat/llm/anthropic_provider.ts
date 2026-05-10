import Anthropic from '@anthropic-ai/sdk';
import { LLMMessage, LLMProvider, LLMResult, LLMSettings } from './types';

export class AnthropicProvider implements LLMProvider {
    public readonly supportsWebSearch = true;

    private readonly client: Anthropic;

    public constructor() {
        this.client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });
    }

    public async chat(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
        const tools: Anthropic.Tool[] = settings.webSearch
            ? [{ type: 'web_search_20250305', name: 'web_search' } as unknown as Anthropic.Tool]
            : [];

        const response = await this.client.messages.create({
            model: settings.model,
            max_tokens: 4096,
            temperature: settings.temperature,
            ...(settings.systemPrompt ? { system: settings.systemPrompt } : {}),
            messages,
            ...(tools.length > 0 ? { tools } : {}),
        });

        // Extract text content, filtering out tool_use blocks
        const text = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('');

        if (!text) {
            throw new Error('AnthropicProvider.chat: empty text response from Anthropic API');
        }
        const u = response.usage;
        return {
            content: text,
            usage: u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens } : null,
        };
    }
}
