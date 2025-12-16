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
            description: "查看等級詳細資訊",
            options: {
                number: [
                    {
                        name: "left",
                        description: "左邊界",
                        required: true
                    },{
                        name: "right",
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
                    content += `**訊息總數：** ${e.messageCount} `;
                    content += `**當前經驗值：** ${e.xp.userXp} / ${e.xp.levelXp} `;
                    content += `**總經驗值：** ${e.xp.totalXp} `;
                    content += `**平均經驗值：** ${averageXp} \n\n`;
                });
    
                if (content.length < 2000) {
                    await interaction.editReply({ content });
                } else {
                    await interaction.editReply({ content: "太長了...請選短一點的範圍" });
                }
            } else {
                await interaction.editReply({ content: "太長了...請選短一點的範圍" });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法取得等級詳情" });
        }
    }
}