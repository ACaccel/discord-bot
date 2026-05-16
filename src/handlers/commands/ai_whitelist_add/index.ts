import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';

import { DEFAULT_MODELS } from '../../../infra/llm';
import { requireGuildRepos } from '../../require-guild-repos';

import { logError } from '@core/logger';
export default class ai_whitelist_add extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_whitelist_add',
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: '[管理員] 將用戶加入 AI 白名單',
            options: {
                user: [
                    {
                        name: 'user',
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: '要加入白名單的用戶',
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
            const existing = await repos.userApiSetting.findByUserId(target.id);
            if (existing) {
                await interaction.editReply({ content: bot.translator?.t('replies:ai_whitelist.already_in', { user: target.displayName }) ?? '' });
                return;
            }
            await repos.userApiSetting.create(target.id, {
                provider: 'openai',
                model: DEFAULT_MODELS['openai'],
                temperature: 1.0,
                system_prompt: '',
                web_search: false,
            });
            await interaction.editReply({ content: bot.translator?.t('replies:ai_whitelist.added', { user: target.displayName }) ?? '' });
        } catch (err) {
            logError(bot.logger, bot.clientId, interaction.guildId, err);
            await interaction.editReply({ content: bot.translator?.t('errors:db.operation_failed') ?? '' });
        }
    }
}
