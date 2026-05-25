import { describe, expect, it, vi } from 'vitest';

import {
  LlmProviderRegistry,
  MissingApiKeyError,
  type LLMProvider,
} from '../../../../src/infra/llm';

const fakeProvider: LLMProvider = {
  supportsWebSearch: false,
  chat: async () => ({ content: 'x', usage: null }),
};

describe('LlmProviderRegistry', () => {
  it('throws MissingApiKeyError when the API-key map is missing the key', () => {
    const registry = new LlmProviderRegistry([['openai', () => fakeProvider]], {});
    expect(() => registry.resolve('openai')).toThrow(MissingApiKeyError);
  });

  it('throws MissingApiKeyError when the API-key value is the empty string', () => {
    const registry = new LlmProviderRegistry([['openai', () => fakeProvider]], { openai: '' });
    expect(() => registry.resolve('openai')).toThrow(MissingApiKeyError);
  });

  it('resolves and caches the provider when the API key is present', () => {
    const factory = vi.fn(() => fakeProvider);
    const registry = new LlmProviderRegistry([['openai', factory]], { openai: 'sk-test' });
    const a = registry.resolve('openai');
    const b = registry.resolve('openai');
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('throws "unknown provider" when the name is not registered but its key IS set', () => {
    const registry = new LlmProviderRegistry([['openai', () => fakeProvider]], {
      openai: 'sk-test',
      xai: 'sk-test',
    });
    expect(() => registry.resolve('xai')).toThrow(/unknown provider/);
  });

  it('the missing-key gate fires *before* the unknown-provider gate', () => {
    // Unregistered name with no key set surfaces MissingApiKeyError so
    // operators see the actionable signal ("set env var") first.
    const registry = new LlmProviderRegistry([['openai', () => fakeProvider]], {});
    expect(() => registry.resolve('xai')).toThrow(MissingApiKeyError);
  });

  it('reports registered names + has()', () => {
    const registry = new LlmProviderRegistry(
      [
        ['openai', () => fakeProvider],
        ['anthropic', () => fakeProvider],
      ],
      {},
    );
    expect([...registry.names()].sort()).toEqual(['anthropic', 'openai']);
    expect(registry.has('openai')).toBe(true);
    expect(registry.has('gemini')).toBe(false);
  });
});
