import {
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';
import { requireGuildRepos } from '../../require-guild-repos';

export default class list_reply extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "list_reply",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "列出自動回覆",
            options: {
                string: [
                    {
                        name: "keyword",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "關鍵字",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const keyword = interaction.options.get("keyword")?.value as string;
            const repos = await requireGuildRepos(bot, interaction);
            if (repos === null) return;
            const replyList = await repos.reply.findByInput(keyword);
            if (replyList.length === 0) {
                await interaction.editReply({ content: bot.translator?.t('replies:list_reply.not_found', { keyword }) ?? '' });
            } else {
                let content = bot.translator?.t('replies:list_reply.header', { keyword }) ?? '';
                replyList.map((e, i) => {
                    content += `> ${i + 1}. ${e.reply}\n`;
                });
                await interaction.editReply({ content });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: bot.translator?.t('replies:list_reply.failed') ?? '' });
        }
    }
}