import {
    ChatInputCommandInteraction,
    Guild,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class talk extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "talk",
            description: "讓機器人說話",
            options: {
                channel: [
                    {
                        name: "channel",
                        description: "選擇頻道",
                        required: true
                    }
                ],
                string: [
                    {
                        name: "content",
                        description: "就是內容",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        try {
            let ch = interaction.options.get("channel")?.value as string;
            let content = interaction.options.get("content")?.value as string;
            if (!ch || !content) {
                await interaction.reply({ content: "請輸入頻道和內容", ephemeral: true });
                return;
            }
            
            // check existance of channel
            let guild = interaction.guild as Guild;
            let channel = guild.channels.cache.get(ch);
            if (!channel?.isSendable()) {
                await interaction.reply({ content: "頻道不存在或無法傳送訊息", ephemeral: true });
                return;
            }
            
            // avoid to tag everyone
            await interaction.deferReply();
            await interaction.deleteReply();
            if (content.includes("@everyone") || content.includes("@here")) {
                const tagMessage = `${interaction.user.username}好壞喔被我抓到你在 tag 所有人`;
                await channel.send(tagMessage);
            } else {
                await channel.send(content);
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: "無法傳送訊息", ephemeral: true });
        }
    }
}