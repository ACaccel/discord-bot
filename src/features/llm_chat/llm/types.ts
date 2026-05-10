export type LLMProviderName = 'xai' | 'openai' | 'anthropic' | 'gemini';

export interface LLMMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface LLMSettings {
    provider: LLMProviderName;
    model: string;
    temperature: number;
    systemPrompt: string;
    webSearch: boolean;
}

/** Token usage returned alongside an LLM completion. */
export interface LLMUsage {
    inputTokens: number;
    outputTokens: number;
}

export interface LLMResult {
    content: string;
    /** Null when the provider response did not include usage. */
    usage: LLMUsage | null;
}

export interface LLMProvider {
    readonly supportsWebSearch: boolean;
    chat(messages: LLMMessage[], settings: LLMSettings): Promise<LLMResult>;
}

/** Default model per provider. */
export const DEFAULT_MODELS: Record<LLMProviderName, string> = {
    xai: 'grok-3',
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    gemini: 'gemini-2.0-flash',
};

export const DEFAULT_SETTINGS: Omit<LLMSettings, 'provider' | 'model'> = {
    temperature: 1.0,
    systemPrompt: '',
    webSearch: false,
};

/** Environment variable that holds each provider's API key. */
export const PROVIDER_API_KEY_ENV: Record<LLMProviderName, string> = {
    xai: 'XAI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
};

/**
 * Thrown when a provider is selected but its API key env var is unset/empty.
 * Callers can `instanceof` check this to surface a precise message instead of
 * a generic "AI failed" reply.
 */
export class MissingApiKeyError extends Error {
    public readonly provider: LLMProviderName;
    public readonly envVar: string;

    public constructor(provider: LLMProviderName, envVar: string) {
        super(`Missing API key for provider "${provider}" (env var ${envVar} is not set)`);
        this.name = 'MissingApiKeyError';
        this.provider = provider;
        this.envVar = envVar;
    }
}
