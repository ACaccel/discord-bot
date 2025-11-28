import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class change_nickname extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "change_nickname",
            description: "更改bot暱稱",
            options: {
                string: [
                    {
                        name: "nickname",
                        description: "新暱稱",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const guild = interaction.guild;
            if (!guild) {
                await interaction.editReply({ content: "找不到伺服器"});
                return;
            }
    
            const newName = interaction.options.get("nickname")?.value as string;
            const userBot = guild.members.cache.get(bot.client.user?.id as string);
            if (!userBot) {
                await interaction.editReply({ content: "找不到機器人"});
                return;
            }
            await userBot.setNickname(newName);
    
            await interaction.editReply({ content: `已更改暱稱為：${newName}` });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "更改失敗"});
        }
    }
}