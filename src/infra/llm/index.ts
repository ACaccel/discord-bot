/**
 * `infra/llm` barrel.
 *
 * The LLM Strategy lives in the infra layer because every member here
 * either wraps an outbound SDK (the four provider adapters), defines
 * the boundary surface (types, registry), or translates upstream
 * errors into the shared domain taxonomy (`error-translator`).
 *
 * The LLM domain helpers (`models-catalog`, `pricing`) sit here too:
 * both are pure LLM-provider knowledge with no dependency on Discord,
 * plugins, or the bot composition root. Plugin-shaped state such as
 * `SessionManager` belongs in `src/plugins/llm-chat/internal/`
 * instead — that boundary keeps infra free of feature-specific state.
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

export {
  ModelCatalog,
  setActiveModelCatalog,
  getModelCatalog,
  listProviderModels,
} from './models-catalog';
export type { LlmProviderApiKeys } from './registry';
export { calculateCost, formatUsageFooter } from './pricing';
