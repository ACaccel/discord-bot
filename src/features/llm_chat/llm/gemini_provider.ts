import { GoogleGenerativeAI, Content, Tool } from '@google/generative-ai';
import { LLMMessage, LLMProvider, LLMResult, LLMSettings } from './types';

export class GeminiProvider implements LLMProvider {
    public readonly supportsWebSearch = true;

    private readonly client: GoogleGenerativeAI;

    public constructor() {
        this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
    }

    public async chat(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
        const tools: Tool[] = settings.webSearch
            ? [{ googleSearch: {} } as unknown as Tool]
            : [];

        const model = this.client.getGenerativeModel({
            model: settings.model,
            ...(settings.systemPrompt ? { systemInstruction: settings.systemPrompt } : {}),
            generationConfig: { temperature: settings.temperature },
            ...(tools.length > 0 ? { tools } : {}),
        });

        // Convert message history (all but last) to Gemini Content format
        const history: Content[] = messages.slice(0, -1).map((msg) => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
        }));

        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) {
            throw new Error('GeminiProvider.chat: no messages provided');
        }

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(lastMessage.content);
        const text = result.response.text();

        if (!text) {
            throw new Error('GeminiProvider.chat: empty response from Gemini API');
        }
        const meta = result.response.usageMetadata;
        return {
            content: text,
            usage: meta
                ? {
                    inputTokens: meta.promptTokenCount ?? 0,
                    outputTokens: meta.candidatesTokenCount ?? 0,
                }
                : null,
        };
    }
}
