import { describe, expect, it } from 'vitest';

import { buildWhitelistDefaults } from '../../../../src/handlers/commands/ai_whitelist_add/build-default-settings';

describe('buildWhitelistDefaults', () => {
  it('defaults a new whitelist entry to xAI with web search on', () => {
    const defaults = buildWhitelistDefaults('grok-4-1-fast-non-reasoning');
    expect(defaults).toEqual({
      provider: 'xai',
      model: 'grok-4-1-fast-non-reasoning',
      temperature: 1.0,
      system_prompt: '',
      web_search: true,
    });
  });

  it('uses the resolved model id passed in', () => {
    expect(buildWhitelistDefaults('grok-3-mini').model).toBe('grok-3-mini');
  });
});
