import type { LLMUsage } from './types';

/**
 * Per-million-token USD pricing as `[input, output]`.
 *
 * These rates are estimates based on each provider's public list price at
 * commit time and are intended as a rough cost indicator only — actual billing
 * may differ (cached input discounts, batch pricing, web-search surcharges,
 * region pricing, etc. are not modelled). Update this table when pricing
 * changes; missing entries cause `calculateCost` to return null and the
 * caller should display "?" instead of a misleading number.
 */
const MODEL_PRICING_USD_PER_M: Record<string, [number, number]> = {
    // OpenAI (https://openai.com/api/pricing)
    'gpt-4o': [2.5, 10],
    'gpt-4o-mini': [0.15, 0.6],
    'gpt-4-turbo': [10, 30],
    'gpt-4': [30, 60],
    'gpt-3.5-turbo': [0.5, 1.5],
    'o1': [15, 60],
    'o1-mini': [3, 12],
    'o1-preview': [15, 60],
    'o3-mini': [1.1, 4.4],
    'o3': [10, 40],
    'gpt-5': [1.25, 10],
    'gpt-5-mini': [0.25, 2],

    // Anthropic (https://www.anthropic.com/pricing)
    'claude-opus-4-7': [15, 75],
    'claude-opus-4-6': [15, 75],
    'claude-opus-4-5': [15, 75],
    'claude-opus-4-1': [15, 75],
    'claude-opus-4-0': [15, 75],
    'claude-opus-4-20250514': [15, 75],
    'claude-opus-4-1-20250805': [15, 75],
    'claude-opus-4-5-20251101': [15, 75],
    'claude-sonnet-4-6': [3, 15],
    'claude-sonnet-4-5': [3, 15],
    'claude-sonnet-4-0': [3, 15],
    'claude-sonnet-4-20250514': [3, 15],
    'claude-sonnet-4-5-20250929': [3, 15],
    'claude-haiku-4-5': [1, 5],
    'claude-haiku-4-5-20251001': [1, 5],
    'claude-3-haiku-20240307': [0.25, 1.25],

    // Google Gemini (https://ai.google.dev/pricing)
    'gemini-2.5-pro': [1.25, 10],
    'gemini-2.5-flash': [0.3, 2.5],
    'gemini-2.0-flash': [0.1, 0.4],
    'gemini-2.0-flash-lite': [0.075, 0.3],
    'gemini-1.5-pro': [1.25, 5],
    'gemini-1.5-flash': [0.075, 0.3],
    'gemini-1.5-flash-8b': [0.0375, 0.15],

    // xAI (https://docs.x.ai/docs/models)
    'grok-4': [3, 15],
    'grok-4.3': [3, 15],
    'grok-4-1-fast-reasoning': [0.6, 4],
    'grok-4-1-fast-non-reasoning': [0.2, 0.5],
    'grok-3': [3, 15],
    'grok-3-mini': [0.3, 0.5],
    'grok-2-1212': [2, 10],
    'grok-2-vision-1212': [2, 10],
};

/**
 * Compute USD cost for a completion. Returns null when the model is not in
 * the pricing table; callers should render that as a "?" rather than $0.
 */
export function calculateCost(model: string, usage: LLMUsage): number | null {
    const pricing = MODEL_PRICING_USD_PER_M[model];
    if (!pricing) return null;
    const [inputPerM, outputPerM] = pricing;
    return (usage.inputTokens * inputPerM + usage.outputTokens * outputPerM) / 1_000_000;
}

/**
 * Format the per-call usage footer rendered under the bot's reply, e.g.
 *   `-# 123 in / 456 out · ~$0.001234`
 *
 * `-#` is Discord's small-text prefix so the footer renders muted under the
 * main reply. Returns empty string when usage is null (no metadata).
 */
export function formatUsageFooter(model: string, usage: LLMUsage | null): string {
    if (!usage) return '';
    const cost = calculateCost(model, usage);
    const costStr = cost === null ? '~$? (未知 model 計價)' : `~$${cost.toFixed(6)}`;
    return `-# ${usage.inputTokens} in / ${usage.outputTokens} out · ${costStr}`;
}
