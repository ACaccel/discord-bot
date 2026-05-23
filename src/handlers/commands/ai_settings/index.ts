import type {
    ChatInputCommandInteraction} from 'discord.js';
import {
    LabelBuilder,
    ModalBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { type LLMProviderName } from '../../../infra/llm';
import { requireGuildRepos } from '../../require-guild-repos';

import { logError } from '@core/logger';
interface UserApiDoc {
    provider: string;
    model: string;
    temperature: number;
    system_prompt: string;
    web_search: boolean;
}

const PROVIDER_CHOICES: Array<{ name: string; value: LLMProviderName }> = [
    { name: 'xAI (Grok)', value: 'xai' },
    { name: 'OpenAI (GPT)', value: 'openai' },
    { name: 'Anthropic (Claude)', value: 'anthropic' },
    { name: 'Google Gemini', value: 'gemini' },
];

export default class ai_settings extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_settings',
            options: {
                string: [
                    {
                        name: 'provider',
                        required: true,
                        choices: PROVIDER_CHOICES,
                    },
                ],
            },
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        const provider = interaction.options.getString('provider', true) as LLMProviderName;
        const userId = interaction.user.id;
        const repos = await requireGuildRepos(bot, interaction);
        if (repos === null) return;

        // `findByUserId` returns Result<UserApiSettingDoc | undefined,
        // DatabaseError>. On `err`, log the failure and reply with
        // `errors:db.operation_failed`.
        const docResult = await repos.userApiSetting.findByUserId(userId);
        if (!docResult.ok) {
            logError(bot.logger, bot.clientId, interaction.guildId, docResult.error);
            await interaction.reply({ content: bot.translator?.t('errors:db.operation_failed') ?? '', flags: MessageFlags.Ephemeral });
            return;
        }
        const doc = docResult.value as UserApiDoc | undefined;
        if (!doc) {
            await interaction.reply({ content: bot.translator?.t('errors:ai.not_whitelisted') ?? '', flags: MessageFlags.Ephemeral });
            return;
        }

        // ModelCatalog.list is synchronous: cache hit -> live list,
        // cache miss -> empty array (it kicks off a background SDK
        // refresh). We never fall back to a guessed list, so the user
        // gets an honest signal when the provider is unreachable
        // instead of seeing stale model names treated as canonical.
        // The catalog is published by LlmChatPlugin.init via
        // `ctx.registerInstance`; bots without that plugin (or pre-init
        // dispatches in tests) surface as `undefined` here.
        const modelOptions = bot.modelCatalog?.list(provider) ?? [];
        if (modelOptions.length === 0) {
            await interaction.reply({
                content: bot.translator?.t('replies:ai_settings.model_list_unavailable', { provider }) ?? '',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const modal = buildSettingsModal(provider, doc, modelOptions, bot.translator);
        await interaction.showModal(modal);
    }
}

function buildSettingsModal(
    provider: LLMProviderName,
    current: UserApiDoc,
    modelOptions: string[],
    translator: BaseBot['translator'],
): ModalBuilder {
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
            new LabelBuilder()
                .setLabel('Model')
                .setStringSelectMenuComponent(modelSelect),
            new LabelBuilder()
                .setLabel('Temperature (0.0 – 2.0)')
                .setTextInputComponent(temperatureInput),
            new LabelBuilder()
                .setLabel('Web Search')
                .setStringSelectMenuComponent(webSearchSelect),
            new LabelBuilder()
                .setLabel('System Prompt')
                .setTextInputComponent(systemPromptInput),
        );
}
