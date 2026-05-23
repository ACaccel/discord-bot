import { describe, expect, it } from 'vitest';

import { checkAiSettingsReady } from '../../../../src/handlers/commands/ai_settings/validate-ai-settings';
import type { UserApiDoc } from '../../../../src/handlers/commands/ai_settings/provider-choices';

const validDoc: UserApiDoc = {
  provider: 'openai',
  model: 'gpt-4',
  temperature: 0.7,
  system_prompt: '',
  web_search: false,
};

describe('checkAiSettingsReady', () => {
  it('returns no_doc when the user has no api setting row', () => {
    expect(checkAiSettingsReady(undefined, ['gpt-4'])).toEqual({ ok: false, reason: 'no_doc' });
  });

  it('returns no_models when the model catalog is empty', () => {
    expect(checkAiSettingsReady(validDoc, [])).toEqual({ ok: false, reason: 'no_models' });
  });

  it('returns ok with the supplied doc when both inputs are valid', () => {
    expect(checkAiSettingsReady(validDoc, ['gpt-4'])).toEqual({ ok: true, doc: validDoc });
  });
});
