import {
    ChatInputCommandInteraction,
    Guild,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class talk_signed extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "talk_signed",
            description: "讓機器人說話(署名)",
            options: {
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
            let content = interaction.options.get("content")?.value as string;
            if (!content) {
                await interaction.reply({ content: "請輸入內容", ephemeral: true });
                return;
            }
            
            // check existance of channel and member
            let guild = interaction.guild as Guild;
            let channel = interaction.channel;
            if (!channel?.isSendable()) {
                await interaction.reply({ content: "頻道不存在或無法傳送訊息", ephemeral: true });
                return;
            }
            let guild_member = interaction.member && 'displayName' in interaction.member ? interaction.member : null;
            if (!guild_member) {
                await interaction.reply({ content: "無法取得成員資訊", ephemeral: true });
                return;
            }
            
            // avoid to tag everyone
            await interaction.deferReply();
            await interaction.deleteReply();
            if (content.includes("@everyone") || content.includes("@here")) {
                const tagMessage = `${guild_member.displayName}(${interaction.user.username})好壞喔被我抓到你在 tag 所有人`;
                await channel.send(tagMessage);
            } else {
                await channel.send(`${guild_member.displayName}(${interaction.user.username}): ${content}`);
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: "無法傳送訊息", ephemeral: true });
        }
    }
}