import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { LLMProviderName, PROVIDER_API_KEY_ENV } from '../../../infra/llm';

/** TTL for cached model lists. */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Discord StringSelectMenu hard limit. */
const SELECT_MENU_MAX_OPTIONS = 25;

interface CacheEntry {
    list: string[];
    expiresAt: number;
}

const cache = new Map<LLMProviderName, CacheEntry>();

/**
 * Tracks providers whose live fetch is in flight, so concurrent callers don't
 * trigger duplicate API requests for the same provider.
 */
const inFlight = new Set<LLMProviderName>();

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
 *
 * Synchronous return is required because this sits on the critical path of
 * `/ai_settings`, which must call `interaction.showModal` within Discord's
 * ~3 second initial-response window.
 */
export function listProviderModels(provider: LLMProviderName): string[] {
    const cached = cache.get(provider);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.list;
    }

    scheduleBackgroundFetch(provider);
    return [];
}

function scheduleBackgroundFetch(provider: LLMProviderName): void {
    if (inFlight.has(provider)) return;
    inFlight.add(provider);
    void fetchModels(provider)
        .then((raw) => {
            const list = normalizeList(raw);
            // Only cache non-empty results; an empty list means the upstream
            // returned nothing usable and we want the next caller to retry
            // rather than be stuck with no options for the full TTL.
            if (list.length > 0) {
                cache.set(provider, { list, expiresAt: Date.now() + CACHE_TTL_MS });
            }
        })
        .catch(() => {
            // Swallow: the next call will retry. Callers see an empty list
            // and surface a "no available models" message until success.
        })
        .finally(() => {
            inFlight.delete(provider);
        });
}

/**
 * Dispatch to the per-provider listing implementation. Throws if the API key
 * is unset or the underlying SDK rejects.
 */
async function fetchModels(provider: LLMProviderName): Promise<string[]> {
    const apiKey = process.env[PROVIDER_API_KEY_ENV[provider]];
    if (!apiKey) {
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
        if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) continue;
        // Strip the `models/` prefix returned by the REST API.
        ids.push(m.name.replace(/^models\//, ''));
    }
    return ids;
}

function normalizeList(list: string[]): string[] {
    return Array.from(new Set(list)).sort().slice(0, SELECT_MENU_MAX_OPTIONS);
}
