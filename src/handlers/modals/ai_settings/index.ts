import { ModalSubmitInteraction, MessageFlags } from 'discord.js';
import { BaseBot } from '@bot';
import { ModalHandler } from '@modal';
import { logger } from '@utils';
import { LLMProviderName } from '@llm_chat';

const VALID_PROVIDERS: ReadonlySet<LLMProviderName> = new Set(['xai', 'openai', 'anthropic', 'gemini']);

export default class ai_settings_modal extends ModalHandler {
    public override async execute(interaction: ModalSubmitInteraction, bot: BaseBot): Promise<void> {
        // customId format: ai_settings|<provider>
        const [modalType, providerRaw] = interaction.customId.split('|');
        if (modalType !== 'ai_settings' || !providerRaw || !VALID_PROVIDERS.has(providerRaw as LLMProviderName)) {
            await interaction.reply({ content: bot.translator?.t('replies:ai_settings.modal_id_error') ?? '', flags: MessageFlags.Ephemeral });
            return;
        }
        const provider = providerRaw as LLMProviderName;

        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: bot.translator?.t('errors:command.guild_only') ?? '', flags: MessageFlags.Ephemeral });
            return;
        }

        const userId = interaction.user.id;
        const repos = bot.guildInfo[guildId]?.repos;
        if (!repos) {
            await interaction.reply({ content: bot.translator?.t('errors:db.connection_failed') ?? '', flags: MessageFlags.Ephemeral });
            return;
        }

        // Read fields. Select menus return readonly string[].
        const modelValues = interaction.fields.getStringSelectValues('model');
        const webSearchValues = interaction.fields.getStringSelectValues('web_search');
        const tempStr = interaction.fields.getTextInputValue('temperature');
        const systemPrompt = interaction.fields.getTextInputValue('system_prompt');

        const model = modelValues[0];
        const webSearchValue = webSearchValues[0];
        if (!model || !webSearchValue) {
            await interaction.reply({ content: bot.translator?.t('replies:ai_settings.missing_model_or_web_search') ?? '', flags: MessageFlags.Ephemeral });
            return;
        }

        const temperature = Number.parseFloat(tempStr);
        if (Number.isNaN(temperature) || temperature < 0 || temperature > 2) {
            await interaction.reply({
                content: bot.translator?.t('replies:ai_settings.invalid_temperature') ?? '',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            const doc = await repos.userApiSetting.findByUserId(userId);
            if (!doc) {
                await interaction.reply({ content: bot.translator?.t('errors:ai.not_whitelisted') ?? '', flags: MessageFlags.Ephemeral });
                return;
            }
            await repos.userApiSetting.update(userId, {
                provider,
                model,
                temperature,
                web_search: webSearchValue === 'on',
                system_prompt: systemPrompt,
            });
        } catch (err) {
            logger.errorLogger(bot.clientId, guildId, err);
            await interaction.reply({ content: bot.translator?.t('errors:db.operation_failed') ?? '', flags: MessageFlags.Ephemeral });
            return;
        }

        // Show the full system prompt. Cap below Discord's 2000-char message
        // limit so the surrounding bullet lines still fit; truncate with an
        // explicit marker rather than silently dropping the tail.
        const PROMPT_DISPLAY_MAX = 1700;
        const promptDisplay = systemPrompt
            ? systemPrompt.length > PROMPT_DISPLAY_MAX
                ? `\n\`\`\`\n${systemPrompt.slice(0, PROMPT_DISPLAY_MAX)}\n…（共 ${systemPrompt.length} 字，已截斷）\n\`\`\``
                : `\n\`\`\`\n${systemPrompt}\n\`\`\``
            : '（未設定）';
        await interaction.reply({
            content: [
                '✅ AI 設定已更新：',
                `• Provider: \`${provider}\``,
                `• Model: \`${model}\``,
                `• Temperature: \`${temperature}\``,
                `• Web Search: ${webSearchValue === 'on' ? '開啟' : '關閉'}`,
                `• System Prompt: ${promptDisplay}`,
            ].join('\n'),
            flags: MessageFlags.Ephemeral,
        });
    }
}
