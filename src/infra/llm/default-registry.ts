/**
 * Default {@link LlmProviderRegistry} wired with every production
 * provider. Constructed lazily via {@link createDefaultRegistry} so
 * a test that needs an empty / partial registry can build its own
 * without paying for the SDK constructors.
 */
import { AnthropicProvider } from './anthropic-provider';
import { GeminiProvider } from './gemini-provider';
import { OpenAIProvider } from './openai-provider';
import { XAIProvider } from './xai-provider';
import { LlmProviderRegistry } from './registry';

export const createDefaultRegistry = (): LlmProviderRegistry =>
  new LlmProviderRegistry([
    ['xai', () => new XAIProvider()],
    ['openai', () => new OpenAIProvider()],
    ['anthropic', () => new AnthropicProvider()],
    ['gemini', () => new GeminiProvider()],
  ]);
