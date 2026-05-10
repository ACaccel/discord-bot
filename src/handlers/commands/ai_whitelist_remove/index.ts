import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class ai_whitelist_remove extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_whitelist_remove',
            description: '[管理員] 將用戶從 AI 白名單移除',
            options: {
                user: [
                    {
                        name: 'user',
                        description: '要移除的用戶',
                        required: true,
                    },
                ],
            },
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== bot.adminId) {
            await interaction.editReply({ content: '只有管理員可以執行此指令。' });
            return;
        }

        const target = interaction.options.getUser('user', true);
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.editReply({ content: '此指令只能在伺服器中使用。' });
            return;
        }

        const UserApiSetting = bot.guildInfo[guildId]?.db?.models['UserApiSetting'];
        if (!UserApiSetting) {
            await interaction.editReply({ content: '資料庫連線異常，請稍後再試。' });
            return;
        }

        try {
            const result = await UserApiSetting.deleteOne({ userId: target.id });
            if (result.deletedCount === 0) {
                await interaction.editReply({ content: `${target.displayName} 不在白名單中。` });
                return;
            }
            await interaction.editReply({ content: `已將 ${target.displayName} 從白名單移除。` });
        } catch (err) {
            logger.errorLogger(bot.clientId, guildId, err);
            await interaction.editReply({ content: '資料庫操作失敗，請稍後再試。' });
        }
    }
}
