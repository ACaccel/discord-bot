import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class ai_whitelist_remove extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_whitelist_remove',
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: '[管理員] 將用戶從 AI 白名單移除',
            options: {
                user: [
                    {
                        name: 'user',
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: '要移除的用戶',
                        required: true,
                    },
                ],
            },
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== bot.adminId) {
            await interaction.editReply({ content: bot.translator?.t('errors:permission.admin_only_short') ?? '' });
            return;
        }

        const target = interaction.options.getUser('user', true);
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
            const removed = await repos.userApiSetting.deleteByUserId(target.id);
            if (!removed) {
                await interaction.editReply({ content: bot.translator?.t('replies:ai_whitelist.not_in', { user: target.displayName }) ?? '' });
                return;
            }
            await interaction.editReply({ content: bot.translator?.t('replies:ai_whitelist.removed', { user: target.displayName }) ?? '' });
        } catch (err) {
            logger.errorLogger(bot.clientId, guildId, err);
            await interaction.editReply({ content: bot.translator?.t('errors:db.operation_failed') ?? '' });
        }
    }
}
