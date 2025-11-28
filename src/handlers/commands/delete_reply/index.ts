import { 
    ActionRowBuilder,
    ChatInputCommandInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class delete_reply extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "delete_reply",
            description: "刪除自動回覆",
            options: {
                string: [
                    {
                        name: "keyword",
                        description: "關鍵字",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const key = interaction.options.get("keyword")?.value as string;
            const db = bot.guildInfo[interaction.guild?.id as string].db;
            if (!db) {
                await interaction.editReply({ content: "找不到資料庫" });
                return;
            }
            const existPair = await db.models["Reply"].find({ input: key });
    
            // select menu
            let selectRows = []
            for (let i = 0; i < existPair.length; i += 25) {
                const select = new StringSelectMenuBuilder()
                    .setCustomId(`delete_reply|${key}|${i/25}`)
                    .setPlaceholder('選擇要刪除的回覆')
                    .addOptions(
                        existPair.slice(i, i + 25).map((reply: any, idx: number) =>
                            new StringSelectMenuOptionBuilder()
                            .setLabel(reply.reply.length > 60 ? `${i + idx + 1}. ` + reply.reply.slice(0, 60) + "..." : `${i + idx + 1}. ` + reply.reply)
                            .setValue(reply.id)
                        )
                    );
                const row = new ActionRowBuilder<StringSelectMenuBuilder>()
                    .addComponents(select);
                selectRows.push(row);
            }
    
            // image preview
            let previewContent = "圖片預覽：\n";
            existPair.forEach((reply: any, idx: number) => {
                if (typeof reply.reply === "string" && reply.reply.startsWith("http")) {
                    previewContent += `${idx+1} - ${reply.reply}\n`;
                }
            });
    
            /*
            // Deprecated! (due to discord cdn image expiration policy, leading to image parse failure)
            // Generate a preview image with all image replies (local, not external API)
            // This requires node-canvas and node-fetch for loading images
            if (imageReplies.length > 0) {
                try {
    
                // Limit preview to 10 images for performance
                const previewImages = imageReplies.slice(0, 10);
    
                // Image size and layout
                const imgWidth = 128, imgHeight = 128, padding = 16;
                const fontSize = 18;
                const canvasWidth = imgWidth + 400;
                const canvasHeight = previewImages.length * (imgHeight + padding);
    
                const canvas = createCanvas(canvasWidth, canvasHeight);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = "#fff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
    
                ctx.font = `${fontSize}px sans-serif`;
                ctx.fillStyle = "#222";
    
                for (let i = 0; i < previewImages.length; i++) {
                    const reply = previewImages[i];
                    // Draw text (link)
                    ctx.fillText(reply.reply, imgWidth + 24, i * (imgHeight + padding) + fontSize + 8);
    
                    // Draw image
                    try {
                        // 用 axios 抓圖片並取得 buffer
                        const res = await axios.get(reply.reply, { responseType: 'arraybuffer' });
                        const buffer = Buffer.from(res.data);
    
                        const img = await loadImage(buffer);
                        ctx.drawImage(img, 0, i * (imgHeight + padding), imgWidth, imgHeight);
                    } catch (e) {
                        // Draw a placeholder if image fails
                        console.log(e);
                        ctx.fillStyle = "#ccc";
                        ctx.fillRect(0, i * (imgHeight + padding), imgWidth, imgHeight);
                        ctx.fillStyle = "#f00";
                        ctx.fillText("無法載入", 10, i * (imgHeight + padding) + imgHeight / 2);
                        ctx.fillStyle = "#222";
                    }
                }
    
                const buffer = canvas.toBuffer('image/png');
                const attachment = new AttachmentBuilder(buffer, { name: 'preview.png' });
                await interaction.followUp({
                    content: '圖片回覆預覽（前10筆）：',
                    files: [attachment],
                    ephemeral: true
                });
                } catch (err) {
                    // console.log(err)
                    await interaction.followUp({ content: '無法產生圖片預覽', ephemeral: true });
                }
            }
            */
    
            await interaction.editReply({
                content: previewContent,
                components: [...selectRows]
            });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法刪除訊息回覆配對" });
        }
    }
}