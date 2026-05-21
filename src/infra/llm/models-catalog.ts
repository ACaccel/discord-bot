/**
 * Live model-catalog cache for the LLM Strategy.
 *
 * Wraps each provider's SDK list-models call and caches the result
 * with a TTL so `/ai_settings` can build a Discord StringSelectMenu
 * synchronously (the interaction has a ~3-second window before
 * Discord auto-acks). Cache misses return `[]` immediately and kick
 * off a background fetch that fills the cache for the next caller —
 * the empty-array contract gives the UI a clear "no models available"
 * signal instead of a stale guess.
 *
 * The cache and API keys are instance state on the `ModelCatalog`
 * class, not module-level globals: two bots in one process (the test
 * harness, a multi-tenant deploy) each get their own catalog without
 * clobbering each other. The plugin holds the instance and the
 * `/ai_settings` handler reaches it through the bot-scoped accessor —
 * per-bot isolation, explicit init order, testable.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { type LLMProviderName } from './types';
import type { LlmProviderApiKeys } from './registry';

/** TTL for cached model lists. */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Discord StringSelectMenu hard limit. */
const SELECT_MENU_MAX_OPTIONS = 25;

interface CacheEntry {
  list: string[];
  expiresAt: number;
}

export class ModelCatalog {
  private readonly cache = new Map<LLMProviderName, CacheEntry>();
  private readonly inFlight = new Set<LLMProviderName>();

  public constructor(private readonly apiKeys: LlmProviderApiKeys) {}

  /**
   * Returns the live model list for a provider, **synchronously**.
   *
   *   - cache hit  -> live list from a successful prior SDK call
   *   - cache miss -> empty array, plus a fire-and-forget background fetch that
   *                   fills the cache for the next caller
   *
   * Returning an empty array (rather than a hardcoded fallback) is intentional:
   * the caller is expected to surface a clear "no available models" message so
   * the user knows their provider/API key/network is the actual problem instead
   * of seeing a stale guess as the canonical list.
   */
  public list(provider: LLMProviderName): string[] {
    const cached = this.cache.get(provider);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.list;
    }

    this.scheduleBackgroundFetch(provider);
    return [];
  }

  private scheduleBackgroundFetch(provider: LLMProviderName): void {
    if (this.inFlight.has(provider)) return;
    this.inFlight.add(provider);
    void this.fetchModels(provider)
      .then((raw) => {
        const list = normalizeList(raw);
        // Only cache non-empty results; an empty list means the upstream
        // returned nothing usable and we want the next caller to retry
        // rather than be stuck with no options for the full TTL.
        if (list.length > 0) {
          this.cache.set(provider, { list, expiresAt: Date.now() + CACHE_TTL_MS });
        }
      })
      .catch(() => {
        // Swallow: the next call will retry. Callers see an empty list
        // and surface a "no available models" message until success.
      })
      .finally(() => {
        this.inFlight.delete(provider);
      });
  }

  private async fetchModels(provider: LLMProviderName): Promise<string[]> {
    const apiKey = this.apiKeys[provider];
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error(`API key for ${provider} not set`);
    }

    switch (provider) {
      case 'openai':
        return fetchOpenAICompatibleModels(apiKey, undefined, /^(gpt-|o\d|chatgpt-)/i);
      case 'xai':
        return fetchOpenAICompatibleModels(apiKey, 'https://api.x.ai/v1', /grok/i);
      case 'anthropic':
        return fetchAnthropicModels(apiKey);
      case 'gemini':
        return fetchGeminiModels(apiKey);
    }
  }
}

async function fetchOpenAICompatibleModels(
  apiKey: string,
  baseURL: string | undefined,
  chatIdPattern: RegExp,
): Promise<string[]> {
  const client = new OpenAI({ apiKey, baseURL });
  const ids: string[] = [];
  for await (const model of client.models.list()) {
    if (chatIdPattern.test(model.id)) ids.push(model.id);
  }
  return ids;
}

async function fetchAnthropicModels(apiKey: string): Promise<string[]> {
  const client = new Anthropic({ apiKey });
  const ids: string[] = [];
  for await (const model of client.models.list()) {
    ids.push(model.id);
  }
  return ids;
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  // The @google/generative-ai SDK does not expose listModels; use the REST
  // endpoint directly and keep only models supporting generateContent.
  const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}&pageSize=200`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gemini listModels HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  const ids: string[] = [];
  for (const m of json.models ?? []) {
    if (!m.name) continue;
    if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent'))
      continue;
    // Strip the `models/` prefix returned by the REST API.
    ids.push(m.name.replace(/^models\//, ''));
  }
  return ids;
}

function normalizeList(list: string[]): string[] {
  return Array.from(new Set(list)).sort().slice(0, SELECT_MENU_MAX_OPTIONS);
}

/**
 * Module-level holder for the bot-scoped catalog.
 *
 * The plugin contract intentionally does not expose a way for plugins
 * to register IoC tokens (per the Service Locator anti-pattern guard
 * in eslint.config.mjs:88-112) and handlers cannot resolve from the
 * container either. The catalog therefore lives behind this thin
 * accessor pair, set once during `LlmChatPlugin.init` and read by
 * `/ai_settings` and `/ai_status` handlers via {@link
 * getModelCatalog}.
 *
 * Per-bot isolation in tests: tests construct their own ModelCatalog
 * directly (the class is exported) — they do NOT call
 * `setActiveModelCatalog`. Production has exactly one llm-chat bot.
 */
let activeModelCatalog: ModelCatalog | undefined;

export const setActiveModelCatalog = (catalog: ModelCatalog): void => {
  activeModelCatalog = catalog;
};

export const getModelCatalog = (): ModelCatalog | undefined => activeModelCatalog;

/**
 * Convenience accessor for handlers that need the live model list.
 * Returns `[]` when the catalog is not yet active (e.g. a pre-init
 * dispatch in tests). Treats a missing catalog the same as a cache
 * miss — the empty-array contract is part of the synchronous `/ai_settings`
 * Discord-reply window.
 */
export const listProviderModels = (provider: LLMProviderName): string[] =>
  activeModelCatalog?.list(provider) ?? [];
