import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  // Each test sets / clears env vars to drive the API-key gate.
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['XAI_API_KEY'];
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws MissingApiKeyError when the API-key env var is empty', () => {
    const registry = new LlmProviderRegistry([['openai', () => fakeProvider]]);
    expect(() => registry.resolve('openai')).toThrow(MissingApiKeyError);
  });

  it('resolves and caches the provider when the API key is present', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    const factory = vi.fn(() => fakeProvider);
    const registry = new LlmProviderRegistry([['openai', factory]]);
    const a = registry.resolve('openai');
    const b = registry.resolve('openai');
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('throws "unknown provider" when the name is not registered but its env key IS set', () => {
    // Key present so the missing-key gate does NOT fire; the
    // factory-missing path is the one we want to exercise.
    process.env['XAI_API_KEY'] = 'sk-test';
    const registry = new LlmProviderRegistry([['openai', () => fakeProvider]]);
    expect(() => registry.resolve('xai')).toThrow(/unknown provider/);
  });

  it('the missing-key gate fires *before* the unknown-provider gate', () => {
    // Sanity-check the ordering: an unregistered name with NO key set
    // surfaces MissingApiKeyError, because operators need the
    // actionable signal ("set env var") first.
    const registry = new LlmProviderRegistry([['openai', () => fakeProvider]]);
    expect(() => registry.resolve('xai')).toThrow(MissingApiKeyError);
  });

  it('reports registered names + has()', () => {
    const registry = new LlmProviderRegistry([
      ['openai', () => fakeProvider],
      ['anthropic', () => fakeProvider],
    ]);
    expect([...registry.names()].sort()).toEqual(['anthropic', 'openai']);
    expect(registry.has('openai')).toBe(true);
    expect(registry.has('gemini')).toBe(false);
  });
});
