import type { LLMProviderName } from '../../../infra/llm';

/**
 * Persisted per-user AI settings. The handler reads / writes this
 * shape through the userApiSetting repo; we keep the type next to
 * the provider choices so changes land in one place.
 */
export interface UserApiDoc {
  provider: string;
  model: string;
  temperature: number;
  system_prompt: string;
  web_search: boolean;
}

/**
 * Slash-command choices for the `provider` option. The labels are
 * the user-facing display name; the values are the canonical
 * LLMProviderName tokens used throughout the LLM infrastructure.
 */
export const PROVIDER_CHOICES: Array<{ name: string; value: LLMProviderName }> = [
  { name: 'xAI (Grok)', value: 'xai' },
  { name: 'OpenAI (GPT)', value: 'openai' },
  { name: 'Anthropic (Claude)', value: 'anthropic' },
  { name: 'Google Gemini', value: 'gemini' },
];
