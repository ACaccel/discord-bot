import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class ai_whitelist_list extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_whitelist_list',
            description: '列出目前 AI 白名單的所有用戶',
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
            const docs = await repos.userApiSetting.listAll();
            if (docs.length === 0) {
                await interaction.editReply({ content: '白名單目前為空。' });
                return;
            }

            const header = `**AI 白名單（${docs.length} 位用戶）：**`;
            const lines = docs.map((d) => `<@${d.userId}> — \`${d.provider}\` / \`${d.model}\``);

            // Build pages that stay within Discord's 2000-character limit.
            const MAX = 2000;
            const pages: string[] = [];
            let current = header;
            for (const line of lines) {
                const next = `${current}\n${line}`;
                if (next.length > MAX) {
                    pages.push(current);
                    current = line;
                } else {
                    current = next;
                }
            }
            pages.push(current);

            await interaction.editReply({ content: pages[0]! });
            for (let i = 1; i < pages.length; i++) {
                await interaction.followUp({ content: pages[i]!, flags: MessageFlags.Ephemeral });
            }
        } catch (err) {
            logger.errorLogger(bot.clientId, guildId, err);
            await interaction.editReply({ content: '資料庫操作失敗，請稍後再試。' });
        }
    }
}
