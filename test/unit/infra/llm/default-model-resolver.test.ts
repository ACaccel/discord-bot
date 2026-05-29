import { describe, expect, it, vi } from 'vitest';

import { DefaultModelResolver } from '../../../../src/infra/llm';
import type { ModelCatalog } from '../../../../src/infra/llm/models-catalog';
import { DEFAULT_MODELS, type LLMProviderName } from '../../../../src/infra/llm';

/**
 * Build a fake ModelCatalog whose `listLive` is driven by a per-provider
 * map of either a resolved list or a thrown error. Only `listLive` is
 * exercised by the resolver, so the rest of the surface is left unbound.
 */
const fakeCatalog = (responses: Partial<Record<LLMProviderName, string[] | Error>>): ModelCatalog =>
  ({
    listLive: vi.fn(async (provider: LLMProviderName): Promise<string[]> => {
      const r = responses[provider];
      if (r instanceof Error) throw r;
      return r ?? [];
    }),
  }) as unknown as ModelCatalog;

describe('DefaultModelResolver', () => {
  it('seeds every provider from DEFAULT_MODELS before any refresh', () => {
    const resolver = new DefaultModelResolver(fakeCatalog({}));
    expect(resolver.current('xai')).toBe(DEFAULT_MODELS['xai']);
    expect(resolver.current('openai')).toBe(DEFAULT_MODELS['openai']);
    expect(resolver.current('anthropic')).toBe(DEFAULT_MODELS['anthropic']);
    expect(resolver.current('gemini')).toBe(DEFAULT_MODELS['gemini']);
  });

  it('updates a provider default to the cheapest priced live model', async () => {
    const resolver = new DefaultModelResolver(
      fakeCatalog({
        // grok-3-mini [0.3, 0.5] vs grok-4 [3, 15] -> the mini wins.
        xai: ['grok-4', 'grok-3-mini'],
      }),
    );
    await resolver.refresh();
    expect(resolver.current('xai')).toBe('grok-3-mini');
  });

  it('keeps the previous default when the live list is empty', async () => {
    const resolver = new DefaultModelResolver(fakeCatalog({ openai: [] }));
    await resolver.refresh();
    expect(resolver.current('openai')).toBe(DEFAULT_MODELS['openai']);
  });

  it('keeps the previous default when the fetch throws', async () => {
    const resolver = new DefaultModelResolver(fakeCatalog({ gemini: new Error('no api key') }));
    await resolver.refresh();
    expect(resolver.current('gemini')).toBe(DEFAULT_MODELS['gemini']);
  });

  it('keeps the previous default when no live model has a known price', async () => {
    const resolver = new DefaultModelResolver(
      fakeCatalog({ anthropic: ['claude-unreleased-x', 'claude-mystery-y'] }),
    );
    await resolver.refresh();
    expect(resolver.current('anthropic')).toBe(DEFAULT_MODELS['anthropic']);
  });

  it('replaces a now-legacy default that has dropped off the live list', async () => {
    const resolver = new DefaultModelResolver(
      fakeCatalog({
        // Seed default (grok-4-1-fast-non-reasoning) absent -> next cheapest priced survivor wins.
        xai: ['grok-3-mini', 'grok-4.3'],
      }),
    );
    await resolver.refresh();
    expect(resolver.current('xai')).toBe('grok-3-mini');
  });

  it('resolves each provider independently — one failure does not block others', async () => {
    const resolver = new DefaultModelResolver(
      fakeCatalog({
        xai: new Error('boom'),
        openai: ['gpt-5-nano', 'gpt-4o'],
      }),
    );
    await resolver.refresh();
    expect(resolver.current('xai')).toBe(DEFAULT_MODELS['xai']); // kept
    expect(resolver.current('openai')).toBe('gpt-5-nano'); // updated
  });
});
