import { describe, expect, it } from 'vitest';

import { calculateCost, cheapestModel } from '../../../../src/infra/llm';

describe('cheapestModel', () => {
  it('picks the lowest input-priced model among priced candidates', () => {
    // gpt-5-nano [0.05, 0.4] is cheaper than gpt-4o [2.5, 10] and gpt-5-mini [0.25, 2].
    expect(cheapestModel(['gpt-4o', 'gpt-5-nano', 'gpt-5-mini'])).toBe('gpt-5-nano');
  });

  it('uses output price as the tie-breaker when input prices match', () => {
    // gemini-2.5-flash-lite [0.1, 0.4] vs gemini-2.0-flash [0.1, 0.4] tie on both —
    // first-seen wins; gemini-1.5-flash-8b [0.0375, 0.15] is strictly cheaper.
    expect(cheapestModel(['gemini-2.0-flash', 'gemini-1.5-flash-8b'])).toBe('gemini-1.5-flash-8b');
  });

  it('ignores candidates with no known price', () => {
    expect(cheapestModel(['totally-unknown-model', 'gpt-5-nano'])).toBe('gpt-5-nano');
  });

  it('returns undefined when no candidate is priced', () => {
    expect(cheapestModel(['unknown-a', 'unknown-b'])).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    expect(cheapestModel([])).toBeUndefined();
  });

  it('prices the seeded cheapest defaults so they are never "unknown model"', () => {
    // The DEFAULT_MODELS seed must have pricing entries, otherwise the
    // usage footer would render "?" for every fresh whitelist user.
    for (const model of [
      'grok-4-1-fast-non-reasoning',
      'gpt-5-nano',
      'claude-haiku-4-5',
      'gemini-2.5-flash-lite',
    ]) {
      expect(calculateCost(model, { inputTokens: 1_000_000, outputTokens: 0 })).not.toBeNull();
    }
  });
});
