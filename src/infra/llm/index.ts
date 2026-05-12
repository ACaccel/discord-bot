/**
 * `infra/llm` barrel.
 *
 * The LLM Strategy lives in the infra layer because every member here
 * either wraps an outbound SDK (the four provider adapters), defines
 * the boundary surface (types, registry), or translates upstream
 * errors into the shared domain taxonomy (`error-translator`).
 *
 * Domain-level concerns (pricing math, model catalog metadata, the
 * in-memory session manager) stay in `features/llm_chat/` — that
 * boundary is intentional and worth preserving.
 */
export {
  type LLMMessage,
  type LLMProvider,
  type LLMProviderName,
  type LLMResult,
  type LLMSettings,
  type LLMUsage,
  DEFAULT_MODELS,
  DEFAULT_SETTINGS,
  PROVIDER_API_KEY_ENV,
  MissingApiKeyError,
} from './types';

export { LlmProviderRegistry, type LlmProviderFactory } from './registry';
export { LLMService } from './llm-service';
export { createDefaultRegistry } from './default-registry';
export { translateProviderError } from './error-translator';

export { OpenAIProvider } from './openai-provider';
export { AnthropicProvider } from './anthropic-provider';
export { GeminiProvider } from './gemini-provider';
export { XAIProvider } from './xai-provider';
