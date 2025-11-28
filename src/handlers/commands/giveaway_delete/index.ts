import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger, giveaway } from '@utils';

export default class giveaway_delete extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "giveaway_delete",
            description: "刪除抽獎",
            options: {
                string: [
                    {
                        name: "message_id",
                        description: "抽獎訊息ID (Bot發布的公告)",
                        required: true
                    }
                ]
            }       
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const message_id = interaction.options.get("message_id")?.value as string;
            const guild = interaction.guild;
            if (!guild) {
                await interaction.editReply({ content: "找不到伺服器" });
                return;
            }
            await giveaway.deleteGiveaway(bot, guild.id, message_id);
            await interaction.editReply({ content: "抽獎已刪除" });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法刪除抽獎" });
        }
    }
}