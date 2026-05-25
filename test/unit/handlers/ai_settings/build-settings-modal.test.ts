import type { BaseBot } from '@bot';
import { ModalBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { buildSettingsModal } from '../../../../src/handlers/commands/ai_settings/build-settings-modal';
import type { UserApiDoc } from '../../../../src/handlers/commands/ai_settings/provider-choices';

const doc: UserApiDoc = {
  provider: 'openai',
  model: 'gpt-4',
  temperature: 0.5,
  system_prompt: 'be helpful',
  web_search: true,
};

// Stub translator that returns a short, non-empty label so each
// underlying builder passes its min/max length validators. The actual
// i18n key wiring is exercised in formatLeaderboard / inspect_member_ids
// unit tests; here we only care about the modal's structural shape.
const stubTranslator = {
  t: (key: string): string => key.split('.').pop() ?? key,
} as unknown as BaseBot['translator'];

describe('buildSettingsModal', () => {
  it('returns a ModalBuilder instance', () => {
    const modal = buildSettingsModal('openai', doc, ['gpt-4', 'gpt-4o'], stubTranslator);
    expect(modal).toBeInstanceOf(ModalBuilder);
  });

  it('encodes the provider into the modal custom id', () => {
    const modal = buildSettingsModal('openai', doc, ['gpt-4', 'gpt-4o'], stubTranslator);
    const data = (modal as unknown as { data: { custom_id?: string } }).data;
    expect(data.custom_id).toBe('ai_settings|openai');
  });

  it('keeps four label components on the modal', () => {
    const modal = buildSettingsModal('anthropic', doc, ['gpt-4', 'gpt-4o'], stubTranslator);
    // discord.js v14 builders may attach components on the builder
    // root or inside `data`; accept either shape so the assertion
    // tracks the actual fluent-builder count.
    const fromRoot = (modal as unknown as { components?: unknown[] }).components;
    const fromData = (modal as unknown as { data?: { components?: unknown[] } }).data?.components;
    const components = fromData ?? fromRoot;
    expect(components).toBeDefined();
    expect(components).toHaveLength(4);
  });
});
