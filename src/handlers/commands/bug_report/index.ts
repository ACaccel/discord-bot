import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class bug_report extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "bug_report",
            description: "回報問題",
            options: {
                string: [
                    {
                        name: "content",
                        description: "問題描述",
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
    
            if (!bot.adminId) {
                throw new Error("Admin ID not found");
            }
    
            // send message to admin via dm
            const admin = await bot.client.users.fetch(bot.adminId);
            if (admin) {
                await admin.send(`Bug Report from ${interaction.user.username}：${content}`);
                await interaction.reply({ content: `問題已回報! 內容: ${content}`, ephemeral: true });
            } else {
                throw new Error("Admin not found");
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: "無法回報問題", ephemeral: true });
        }
    }
}