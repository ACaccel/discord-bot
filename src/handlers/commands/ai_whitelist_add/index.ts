import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';
import { DEFAULT_MODELS } from '@llm_chat';

export default class ai_whitelist_add extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_whitelist_add',
            description: '[管理員] 將用戶加入 AI 白名單',
            options: {
                user: [
                    {
                        name: 'user',
                        description: '要加入白名單的用戶',
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

        const repos = bot.guildInfo[guildId]?.repos;
        if (!repos) {
            await interaction.editReply({ content: '資料庫連線異常，請稍後再試。' });
            return;
        }

        try {
            const existing = await repos.userApiSetting.findByUserId(target.id);
            if (existing) {
                await interaction.editReply({ content: `${target.displayName} 已在白名單中。` });
                return;
            }
            await repos.userApiSetting.create(target.id, {
                provider: 'openai',
                model: DEFAULT_MODELS['openai'],
                temperature: 1.0,
                system_prompt: '',
                web_search: false,
            });
            await interaction.editReply({ content: `已將 ${target.displayName} 加入白名單（預設 provider: openai）。` });
        } catch (err) {
            logger.errorLogger(bot.clientId, guildId, err);
            await interaction.editReply({ content: '資料庫操作失敗，請稍後再試。' });
        }
    }
}
