import type { ChatInputCommandInteraction} from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { requireGuildRepos } from '../../require-guild-repos';

import { logError } from '@core/logger';
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
        const repos = await requireGuildRepos(bot, interaction);
        if (repos === null) return;

        try {
            // G-2: an `err` is re-thrown into the surrounding catch.
            const removedResult = await repos.userApiSetting.deleteByUserId(target.id);
            if (!removedResult.ok) throw removedResult.error;
            if (!removedResult.value) {
                await interaction.editReply({ content: bot.translator?.t('replies:ai_whitelist.not_in', { user: target.displayName }) ?? '' });
                return;
            }
            await interaction.editReply({ content: bot.translator?.t('replies:ai_whitelist.removed', { user: target.displayName }) ?? '' });
        } catch (err) {
            logError(bot.logger, bot.clientId, interaction.guildId, err);
            await interaction.editReply({ content: bot.translator?.t('errors:db.operation_failed') ?? '' });
        }
    }
}
