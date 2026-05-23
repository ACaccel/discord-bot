import { describe, expect, it } from 'vitest';

import { PROVIDER_CHOICES } from '../../../../src/handlers/commands/ai_settings/provider-choices';

describe('PROVIDER_CHOICES', () => {
  it('exposes the four supported LLM providers', () => {
    const values = PROVIDER_CHOICES.map((c) => c.value);
    expect(values).toEqual(['xai', 'openai', 'anthropic', 'gemini']);
  });

  it('has a human-readable name for every choice', () => {
    for (const choice of PROVIDER_CHOICES) {
      expect(choice.name.length).toBeGreaterThan(0);
    }
  });
});
