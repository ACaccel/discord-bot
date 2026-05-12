import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

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

            const repos = bot.guildInfo[interaction.guild?.id as string]?.repos;
            if (!repos) {
                await interaction.editReply({ content: bot.translator?.t('errors:db.not_found') ?? '' });
                return;
            }
            const existPair = await repos.reply.findExactPair(input, reply);

            if (existPair.length === 0) {
                await repos.reply.create(input, reply);
                await interaction.editReply({ content: `已新增 輸入：${input} 回覆：${reply}！` });
            } else {
                await interaction.editReply({ content: `此配對 輸入：${input} 回覆：${reply} 已經存在！` });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法新增訊息回覆配對" });
        }
    }
}