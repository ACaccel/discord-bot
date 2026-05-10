import {
    LLMMessage,
    LLMProvider,
    LLMProviderName,
    LLMResult,
    LLMSettings,
    MissingApiKeyError,
    PROVIDER_API_KEY_ENV,
} from './types';
import { XAIProvider } from './xai_provider';
import { OpenAIProvider } from './openai_provider';
import { AnthropicProvider } from './anthropic_provider';
import { GeminiProvider } from './gemini_provider';

/**
 * Strategy dispatcher for LLM providers.
 *
 * Providers are constructed lazily on first use so that a deployment which
 * only configures one provider's API key does not crash at startup when
 * other providers' SDKs reject the missing credentials.
 */
export class LLMService {
    private readonly factories: Record<LLMProviderName, () => LLMProvider> = {
        xai: () => new XAIProvider(),
        openai: () => new OpenAIProvider(),
        anthropic: () => new AnthropicProvider(),
        gemini: () => new GeminiProvider(),
    };

    private readonly providers: Partial<Record<LLMProviderName, LLMProvider>> = {};

    private getProvider(name: LLMProviderName): LLMProvider {
        const cached = this.providers[name];
        if (cached) return cached;

        // Validate API key before constructing the provider so that callers
        // receive a typed MissingApiKeyError instead of a generic SDK exception.
        const envVar = PROVIDER_API_KEY_ENV[name];
        const keyValue = envVar ? process.env[envVar] : undefined;
        if (!keyValue) {
            throw new MissingApiKeyError(name, envVar);
        }

        const factory = this.factories[name];
        if (!factory) {
            throw new Error(`LLMService.getProvider: unknown provider "${name}"`);
        }
        const instance = factory();
        this.providers[name] = instance;
        return instance;
    }

    /**
     * Send a chat request using the provider and settings specified in `settings`.
     * Throws if the requested provider does not support web search but webSearch is true.
     */
    public async chat(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult> {
        const provider = this.getProvider(settings.provider);
        if (settings.webSearch && !provider.supportsWebSearch) {
            throw new Error(
                `LLMService.chat: provider "${settings.provider}" does not support web search`,
            );
        }
        return provider.chat(messages, settings);
    }
}
