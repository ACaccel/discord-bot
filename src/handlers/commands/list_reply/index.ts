import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

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
            const repos = bot.guildInfo[interaction.guild?.id as string]?.repos;
            if (!repos) {
                await interaction.editReply({ content: bot.translator?.t('errors:db.not_found') ?? '' });
                return;
            }
            const replyList = await repos.reply.findByInput(keyword);
            if (replyList.length === 0) {
                await interaction.editReply({ content: `找不到 輸入：${keyword} 的回覆！` });
            } else {
                let content = `輸入：${keyword} 的回覆：\n`;
                replyList.map((e, i) => {
                    content += `> ${i + 1}. ${e.reply}\n`;
                });
                await interaction.editReply({ content });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: "無法列出訊息回覆配對" });
        }
    }
}