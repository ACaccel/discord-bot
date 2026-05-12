import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class ai_status extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_status',
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: '顯示你目前的 AI 設定',
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.editReply({ content: bot.translator?.t('errors:command.guild_only') ?? '' });
            return;
        }

        const repos = bot.guildInfo[guildId]?.repos;
        if (!repos) {
            await interaction.editReply({ content: bot.translator?.t('errors:db.connection_failed') ?? '' });
            return;
        }

        try {
            const doc = await repos.userApiSetting.findByUserId(userId);

            if (!doc) {
                await interaction.editReply({ content: bot.translator?.t('errors:ai.not_whitelisted') ?? '' });
                return;
            }

            // Truncate system prompt to keep total reply well under Discord's 2000-char limit.
            const PROMPT_PREVIEW_MAX = 1500;
            const promptDisplay = doc.system_prompt
                ? doc.system_prompt.length > PROMPT_PREVIEW_MAX
                    ? `\`${doc.system_prompt.slice(0, PROMPT_PREVIEW_MAX)}…\`（共 ${doc.system_prompt.length} 字，已截斷）`
                    : `\`${doc.system_prompt}\``
                : '（未設定）';
            const lines = [
                `**Provider:** \`${doc.provider}\``,
                `**Model:** \`${doc.model}\``,
                `**Temperature:** \`${doc.temperature}\``,
                `**Web Search:** ${doc.web_search ? '開啟' : '關閉'}`,
                `**System Prompt:** ${promptDisplay}`,
            ];
            await interaction.editReply({ content: lines.join('\n') });
        } catch (err) {
            logger.errorLogger(bot.clientId, guildId, err);
            await interaction.editReply({ content: bot.translator?.t('errors:db.operation_failed') ?? '' });
        }
    }
}
