/**
 * `infra/llm` barrel.
 *
 * The LLM Strategy lives in the infra layer because every member here
 * either wraps an outbound SDK (the four provider adapters), defines
 * the boundary surface (types, registry), or translates upstream
 * errors into the shared domain taxonomy (`error-translator`).
 *
 * Audit C-3 / PR-E E-4 folded the LLM domain helpers (`models-catalog`,
 * `pricing`) that used to live under `src/features/llm_chat/llm/`
 * into this directory — both are pure LLM-provider knowledge and
 * have no dependency on Discord, plugins, or the bot composition
 * root. The plugin-specific `SessionManager` moved into
 * `src/plugins/llm-chat/internal/` instead because that one IS
 * plugin-shaped state.
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

export { listProviderModels, setProviderApiKeys } from './models-catalog';
export type { LlmProviderApiKeys } from './registry';
export { calculateCost, formatUsageFooter } from './pricing';
