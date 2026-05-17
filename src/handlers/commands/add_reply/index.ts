import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';

import { requireGuildRepos } from '../../require-guild-repos';

import { logError } from '@core/logger';
export default class add_reply extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "add_reply",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "新增自動回覆",
            options: {
                string: [
                    {
                        name: "keyword",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "關鍵字",
                        required: true
                    },{
                        name: "reply",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "回覆",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const input = interaction.options.get("keyword")?.value as string;
            const reply = interaction.options.get("reply")?.value as string;

            const repos = await requireGuildRepos(bot, interaction);
            if (repos === null) return;
            const existPair = await repos.reply.findExactPair(input, reply);

            if (existPair.length === 0) {
                await repos.reply.create(input, reply);
                await interaction.editReply({ content: bot.translator?.t('replies:add_reply.added', { input, reply }) ?? '' });
            } else {
                await interaction.editReply({ content: bot.translator?.t('replies:add_reply.already_exists', { input, reply }) ?? '' });
            }
        } catch (error) {
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:add_reply.failed') ?? '' });
        }
    }
}