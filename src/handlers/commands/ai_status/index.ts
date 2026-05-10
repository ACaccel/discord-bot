import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class ai_status extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_status',
            description: '顯示你目前的 AI 設定',
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const userId = interaction.user.id;
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
            const doc = await UserApiSetting.findOne({ userId }).lean() as {
                provider: string; model: string; temperature: number;
                system_prompt: string; web_search: boolean;
            } | null;

            if (!doc) {
                await interaction.editReply({ content: '你不在白名單中，請聯絡管理員。' });
                return;
            }

            // Truncate system prompt to keep total reply well under Discord's 2000-char limit.
            const PROMPT_PREVIEW_MAX = 1500;
            const promptDisplay = doc.system_prompt
                ? doc.system_prompt.length > PROMPT_PREVIEW_MAX
                    ? `\`${doc.system_prompt.slice(0, PROMPT_PREVIEW_MAX)}…\`（共 ${doc.system_prompt.length} 字，已截斷）`
                    : `\`${doc.system_prompt}\``
                : '（未設定）';
            const lines = [
                `**Provider:** \`${doc.provider}\``,
                `**Model:** \`${doc.model}\``,
                `**Temperature:** \`${doc.temperature}\``,
                `**Web Search:** ${doc.web_search ? '開啟' : '關閉'}`,
                `**System Prompt:** ${promptDisplay}`,
            ];
            await interaction.editReply({ content: lines.join('\n') });
        } catch (err) {
            logger.errorLogger(bot.clientId, guildId, err);
            await interaction.editReply({ content: '資料庫操作失敗，請稍後再試。' });
        }
    }
}
