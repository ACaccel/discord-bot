/**
 * LLM provider types and Strategy interface.
 *
 * Phase 5 relocates the LLM Strategy from `src/features/llm_chat/llm/`
 * into `src/infra/llm/` so the boundary lives in the infra layer
 * (alongside `infra/mongo/`, `infra/discord/`). `src/features/llm_chat`
 * keeps domain-level concerns: session manager, pricing, model catalog.
 *
 * Adding a new provider means: write `src/infra/llm/<name>-provider.ts`,
 * register it in {@link defaultProviderRegistry} (`src/infra/llm/registry.ts`),
 * append the name to {@link LLMProviderName}, and the rest of the bot
 * picks it up. The dispatcher ({@link LLMService}) does not branch on
 * provider names internally.
 *
 * Error contract: every provider's `chat()` MUST translate upstream
 * SDK failures into a {@link LlmProviderError} (sub-code carries the
 * boundary detail) before throwing. The contract tests at
 * `test/contract/llm/*` pin this so an SDK upgrade cannot silently
 * regress the translation.
 */
export type LLMProviderName = 'xai' | 'openai' | 'anthropic' | 'gemini';

export interface LLMMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface LLMSettings {
  readonly provider: LLMProviderName;
  readonly model: string;
  readonly temperature: number;
  readonly systemPrompt: string;
  readonly webSearch: boolean;
}

/** Token usage returned alongside an LLM completion. */
export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LLMResult {
  readonly content: string;
  /** `null` when the provider response did not include usage. */
  readonly usage: LLMUsage | null;
}

export interface LLMProvider {
  /** Whether the provider exposes a server-side web-search tool. */
  readonly supportsWebSearch: boolean;
  /**
   * Send a chat request. MUST translate upstream SDK errors into
   * {@link LlmProviderError} before re-throwing.
   */
  chat(messages: readonly LLMMessage[], settings: LLMSettings): Promise<LLMResult>;
}

/** Default model per provider. */
export const DEFAULT_MODELS: Readonly<Record<LLMProviderName, string>> = {
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
export const PROVIDER_API_KEY_ENV: Readonly<Record<LLMProviderName, string>> = {
  xai: 'XAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

/**
 * Thrown when a provider is selected but its API-key env var is empty
 * / unset. Distinct from {@link LlmProviderError} because it surfaces
 * before any HTTP call — there is no upstream to attribute the
 * failure to.
 */
export class MissingApiKeyError extends Error {
  public override readonly name = 'MissingApiKeyError';
  public readonly provider: LLMProviderName;
  public readonly envVar: string;
  public constructor(provider: LLMProviderName, envVar: string) {
    super(`Missing API key for provider "${provider}" (env var ${envVar} is not set)`);
    this.provider = provider;
    this.envVar = envVar;
  }
}
