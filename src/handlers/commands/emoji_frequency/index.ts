import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class emoji_frequency extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "emoji_frequency",
            description: "統計表情符號使用頻率",
            options: {
                string: [
                    {
                        name: "frequency",
                        description: "頻率順序 (optional)",
                        required: false,
                        choices: [
                            { name: "前n低頻率", value: "asc" },
                            { name: "前n高頻率", value: "desc" }
                        ]
                    },{
                        name: "type",
                        description: "動態或靜態 (optional)",
                        required: false,
                        choices: [
                            { name: "動態", value: "animated" },
                            { name: "靜態", value: "static" }
                        ]
                    }
                ],
                number: [
                    {
                        name: "top_n",
                        description: "前n名 (optional, max: 30)",
                        required: false
                    },{
                        name: "last_n_months",
                        description: "搜尋過去n個月 (optional, max: 24)",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const type = interaction.options.get("type")?.value as string || "static";
            const frequency = interaction.options.get("frequency")?.value as string || "asc";
            let top_n = interaction.options.get("top_n")?.value as number || 5;
            let last_n_months = interaction.options.get("last_n_months")?.value as number || 1;
            const guild = interaction.guild;
            if (!guild) {
                await interaction.editReply({ content: "找不到伺服器" });
                return;
            }
            const db = bot.guildInfo[guild.id].db;
            if (!db) {
                await interaction.editReply({ content: "請先設定資料庫" });
                return;
            }
    
            if (top_n > 30) top_n = 30;
            if (last_n_months > 24) last_n_months = 24;
            const n_months_ago = new Date();
            n_months_ago.setMonth(n_months_ago.getMonth() - last_n_months);
    
            // emoji count record
            const textEmoji = new Map<string, number>();
            const reactionEmoji = new Map<string, number>();
            const allEmoji = new Map<string, number>();
            guild.emojis.cache.forEach(emoji => {
                const emojiText = `<${emoji.animated ? "a:" : ":"}${emoji.name}:${emoji.id}>`;
                textEmoji.set(emojiText, 0);
                reactionEmoji.set(emojiText, 0);
                allEmoji.set(emojiText, 0);
            });
            
            // search emojis in database messages
            // Process messages month by month to avoid heap limit
            for (let monthOffset = 0; monthOffset < last_n_months; monthOffset++) {
                const monthStart = new Date();
                monthStart.setMonth(monthStart.getMonth() - monthOffset - 1);
                const monthEnd = new Date();
                monthEnd.setMonth(monthEnd.getMonth() - monthOffset);
                
                const messages = await db.models['Message'].find({
                $expr: {
                    $and: [
                    { $gte: [{ $toLong: "$timestamp" }, monthStart.getTime()] },
                    { $lt: [{ $toLong: "$timestamp" }, monthEnd.getTime()] }
                    ]
                }
                });
                
                messages.forEach((message) => {
                const msgEmojis: string[] = message.content.match(/<a?:\w+:\d+>/g) || [];
                msgEmojis.forEach(emoji => {
                    if (textEmoji.has(emoji)) {
                    textEmoji.set(emoji, (textEmoji.get(emoji) || 0) + 1);
                    }
                });
    
                const msgReactions: any[] = message.reactions || [];
                msgReactions.forEach((reaction) => {
                    const emojiText = `<${reaction.animated ? "a:" : ":"}${reaction.name}:${reaction.id}>`;
                    if (reactionEmoji.has(emojiText)) {
                    reactionEmoji.set(emojiText, (reactionEmoji.get(emojiText) || 0) + reaction.count);
                    }
                });
                });
                
                // Update progress
                await interaction.editReply({ content: `正在處理第 ${monthOffset + 1} / ${last_n_months} 個月的資料...` });
            }
    
            allEmoji.forEach((_, emojiText) => {
                allEmoji.set(emojiText, (textEmoji.get(emojiText) || 0) + (reactionEmoji.get(emojiText) || 0));
            });
            const sortedEmojis = Array.from(allEmoji.entries())
                .filter(([emoji]) => type === "animated" ? emoji.startsWith("<a:") : emoji.startsWith("<:"))
                .sort((a, b) => frequency === "asc" ? a[1] - b[1] : b[1] - a[1])
                .slice(0, top_n);
    
            let content = `最近${last_n_months}個月內使用頻率${frequency === "asc" ? "最低" : "最高"}的 ${top_n} 個${type === "animated" ? "動態" : "靜態"}表情符號：\n`;
            for (let i = 0; i < sortedEmojis.length; i++) {
                const [emoji, _] = sortedEmojis[i];
                content += `${i + 1}. ${emoji} - 總共: ${allEmoji.get(emoji)} 次, 文字內: ${textEmoji.get(emoji)} 次, 訊息反應: ${reactionEmoji.get(emoji)} 次\n`;
                
                // Send every 10 emojis or at the end
                if ((i + 1) % 10 === 0 || i === sortedEmojis.length - 1) {
                    await interaction.followUp({ content });
                    content = "";
                }
            }
            
            if (content === "") {
                await interaction.editReply({ content: "處理完成！" });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法取得表情符號使用頻率" });
        }
    }
}