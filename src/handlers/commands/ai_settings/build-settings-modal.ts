import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BaseBot } from '@bot';

import type { LLMProviderName } from '../../../infra/llm';

import type { UserApiDoc } from './provider-choices';

/**
 * Build the AI-settings modal as a Discord ModalBuilder. The helper
 * depends on Discord builder types — it is intentionally not pure —
 * but it pulls a 60+ line block out of the handler so index.ts can
 * stay under the 150-line cap.
 */
export const buildSettingsModal = (
  provider: LLMProviderName,
  current: UserApiDoc,
  modelOptions: ReadonlyArray<string>,
  translator: BaseBot['translator'],
): ModalBuilder => {
  const t = (key: string, params?: Record<string, string | number>): string =>
    translator?.t(key, params) ?? '';

  const modelSelect = new StringSelectMenuBuilder()
    .setCustomId('model')
    .setPlaceholder(t('replies:ai_settings.select_model_placeholder'))
    .addOptions(
      modelOptions.map((m) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(m)
          .setValue(m)
          .setDefault(m === current.model),
      ),
    );

  const webSearchSelect = new StringSelectMenuBuilder()
    .setCustomId('web_search')
    .setPlaceholder(t('replies:ai_settings.web_search_placeholder'))
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(t('replies:ai_settings.toggle_on'))
        .setValue('on')
        .setDefault(current.web_search),
      new StringSelectMenuOptionBuilder()
        .setLabel(t('replies:ai_settings.toggle_off'))
        .setValue('off')
        .setDefault(!current.web_search),
    );

  const temperatureInput = new TextInputBuilder()
    .setCustomId('temperature')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(current.temperature.toString())
    .setPlaceholder('0.0 – 2.0');

  const systemPromptInput = new TextInputBuilder()
    .setCustomId('system_prompt')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setValue(current.system_prompt ?? '')
    .setPlaceholder(t('replies:ai_settings.system_prompt_placeholder'));

  return new ModalBuilder()
    .setCustomId(`ai_settings|${provider}`)
    .setTitle(t('replies:ai_settings.modal_title', { provider }))
    .setLabelComponents(
      new LabelBuilder().setLabel('Model').setStringSelectMenuComponent(modelSelect),
      new LabelBuilder()
        .setLabel('Temperature (0.0 – 2.0)')
        .setTextInputComponent(temperatureInput),
      new LabelBuilder().setLabel('Web Search').setStringSelectMenuComponent(webSearchSelect),
      new LabelBuilder().setLabel('System Prompt').setTextInputComponent(systemPromptInput),
    );
};
