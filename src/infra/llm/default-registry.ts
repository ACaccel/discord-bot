/**
 * Default {@link LlmProviderRegistry} wired with every production
 * provider. Constructed lazily via {@link createDefaultRegistry} so a
 * test that needs an empty / partial registry can build its own
 * without paying for the SDK constructors.
 *
 * Phase 6 PR 2 made the typed `Env` an explicit input: API keys now
 * flow from `src/core/config` rather than being read from
 * `process.env` inside each provider. A bot that does not use a
 * given provider simply leaves the relevant env var unset — the
 * registry's missing-key gate emits a `MissingApiKeyError` only when
 * something actually asks for that provider.
 */
import type { Env } from '../../core/config';

import { AnthropicProvider } from './anthropic-provider';
import { GeminiProvider } from './gemini-provider';
import { OpenAIProvider } from './openai-provider';
import { XAIProvider } from './xai-provider';
import { LlmProviderRegistry } from './registry';

export const createDefaultRegistry = (env: Env): LlmProviderRegistry =>
  new LlmProviderRegistry(
    [
      ['xai', () => new XAIProvider(env.XAI_API_KEY)],
      ['openai', () => new OpenAIProvider(env.OPENAI_API_KEY)],
      ['anthropic', () => new AnthropicProvider(env.ANTHROPIC_API_KEY)],
      ['gemini', () => new GeminiProvider(env.GEMINI_API_KEY)],
    ],
    {
      xai: env.XAI_API_KEY,
      openai: env.OPENAI_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
      gemini: env.GEMINI_API_KEY,
    },
  );
