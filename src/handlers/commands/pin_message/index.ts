import { 
    ChannelType,
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

// deprecated, discord has added native pin permission
export default class pin_message extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "pin_message",
            description: "釘選訊息",
            options: {
                string: [
                    {
                        name: "action",
                        description: "釘選或取消釘選",
                        required: true,
                        choices: [
                            { name: "釘選", value: "pin" },
                            { name: "取消釘選", value: "unpin" }
                        ]
                    },{
                        name: "message_link",
                        description: "要釘選的訊息連結",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const act = interaction.options.get("action")?.value as string;
            const messageLink = interaction.options.get("message_link")?.value as string;
            const msgID = messageLink.split("/").pop() as string;
    
            // check is in a thread and permission
            if (!interaction.channel?.isThread()) {
                await interaction.editReply({ content: "這個指令只能在討論串使用喔" });
            }
    
            if (interaction.channel?.type !== ChannelType.PublicThread || interaction.user.id !== interaction.channel?.ownerId) {
                await interaction.editReply({ content: "你不是串主喔" });
            }
            
            if (act === "unpin") {
                const msg = await interaction.channel?.messages.fetch(msgID);
                if (msg) await msg.unpin();
                await interaction.editReply({ content: `已取消釘選訊息` });
            } else if (act === "pin") {
                const msg = await interaction.channel?.messages.fetch(msgID);
                if (msg) await msg.pin();
                await interaction.editReply({ content: `已釘選訊息` });
            } else {
                await interaction.editReply({ content: "無效的指令" });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法釘選訊息" });
        }
    }
}