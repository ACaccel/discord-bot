import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger, misc } from '@utils';

export default class sticker_frequency extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "sticker_frequency",
            description: "統計貼圖使用頻率",
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
    
            // sticker count record
            const stickerMap = new Map<string, number>();
            guild.stickers.cache.forEach(sticker => {
                stickerMap.set(sticker.name, 0);
            });
    
            // search stickers in database messages
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
                const stickers: any[] = message.stickers || [];
                stickers.forEach((sticker) => {
                    if (stickerMap.has(sticker.name)) {
                    stickerMap.set(sticker.name, (stickerMap.get(sticker.name) || 0) + 1);
                    }
                });
                });
                
                // update progress
                await interaction.editReply({ content: `正在處理第 ${monthOffset + 1} / ${last_n_months} 個月的資料...` });
            }
    
            const sortedStickers = Array.from(stickerMap.entries())
                .sort((a, b) => frequency === "asc" ? a[1] - b[1] : b[1] - a[1])
                .slice(0, top_n);
    
            let content = `最近${last_n_months}個月內使用頻率${frequency === "asc" ? "最低" : "最高"}的 ${top_n} 個貼圖：\n`;
            sortedStickers.forEach(([sticker, count], index) => {
                content += `${index + 1}. ${sticker} - ${count} 次\n`;
            });
    
            // create a preview image
            let canvasContent: misc.CanvasContent[] = [];
            for (let i = 0; i < sortedStickers.length; i++) {
                const [stickerName, count] = sortedStickers[i];
                const sticker = guild.stickers.cache.find(s => s.name === stickerName);
                if (sticker) {
                    canvasContent.push({
                        url: sticker.url,
                        text: `${i + 1}: ${count}次`
                    });
                }
            }
            const attachment = await misc.listInOneImage(canvasContent);
    
            await interaction.editReply({ content: content, files: attachment ? [attachment] : [] });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法取得貼圖使用頻率" });
        }
    }
}