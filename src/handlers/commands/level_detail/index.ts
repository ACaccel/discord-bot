import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import Mee6LevelsApi from 'mee6-levels-api';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class level_detail extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "level_detail",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "查看等級詳細資訊",
            options: {
                number: [
                    {
                        name: "left",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "左邊界",
                        required: true
                    },{
                        name: "right",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "右邊界",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const left = interaction.options.get("left")?.value as number;
            const right = interaction.options.get("right")?.value as number;
            const rangeSize = right - left;
    
            if (rangeSize <= 10) {
                let content = "";
                const leaderboard = await Mee6LevelsApi.getLeaderboardPage(interaction.guild?.id as string);
    
                leaderboard.slice(left - 1, right).forEach((e, i) => {
                    const averageXp = (e.xp.totalXp / e.messageCount).toPrecision(6);
                    content += `> **${e.rank} - ${e.username}﹝Level ${e.level}﹞**\n`;
                    content += bot.translator?.t('replies:level_detail.message_count', { count: e.messageCount }) ?? '';
                    content += bot.translator?.t('replies:level_detail.current_xp', { userXp: e.xp.userXp, levelXp: e.xp.levelXp }) ?? '';
                    content += bot.translator?.t('replies:level_detail.total_xp', { totalXp: e.xp.totalXp }) ?? '';
                    content += bot.translator?.t('replies:level_detail.average_xp', { averageXp }) ?? '';
                });
    
                if (content.length < 2000) {
                    await interaction.editReply({ content });
                } else {
                    await interaction.editReply({ content: bot.translator?.t('replies:level_detail.too_long') ?? '' });
                }
            } else {
                await interaction.editReply({ content: bot.translator?.t('replies:level_detail.too_long') ?? '' });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:level_detail.failed') ?? '' });
        }
    }
}