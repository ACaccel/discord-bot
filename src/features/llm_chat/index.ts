/**
 * `features/llm_chat` barrel.
 *
 * Phase 5 relocated the LLM Strategy (provider interface, registry,
 * adapters, dispatcher) into `src/infra/llm/`. This barrel re-exports
 * the moved pieces so existing handler callsites that use the
 * `@llm_chat` path alias continue to work; domain-level concerns
 * (session manager, pricing, model catalog) keep living here.
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
  LLMService,
  LlmProviderRegistry,
  createDefaultRegistry,
} from '../../infra/llm';

export { listProviderModels } from './llm/models_catalog';
export { calculateCost, formatUsageFooter } from './llm/pricing';
export { SessionManager } from './session_manager';
