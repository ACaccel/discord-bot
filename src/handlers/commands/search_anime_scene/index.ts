import { 
    ChatInputCommandInteraction,
    EmbedBuilder,
} from 'discord.js';
import axios from 'axios';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class search_anime_scene extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "search_anime_scene",
            description: "搜尋動漫截圖來源",
            options: {
                attachment: [
                    {
                        name: "image",
                        description: "動漫截圖",
                        required: true
                    }
                ],
                number: [
                    {
                        name: "display_num",
                        description: "顯示幾筆搜尋結果 (optional)",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const image = interaction.options.get("image")?.attachment;
            if (!image) {
                await interaction.editReply({ content: "請上傳圖片" });
                return;
            }

            await axios.post(`https://api.trace.moe/search?url=${encodeURIComponent(image.url)}`)
            .then(async (response) => {
                if (response.data.error === "") {
                    type IResult = {
                        filename: string;
                        episode: number;
                        similarity: number;
                        from: number;
                        to: number;
                        video: string;
                        image: string;
                    }
                    let embedarr: EmbedBuilder[] = [];
                    const result = response.data.result as IResult[];
                    const num_results = interaction.options.get("display_num")?.value ?
                        interaction.options.get("display_num")?.value as number > result.length ? 
                            result.length as number : 
                            interaction.options.get("display_num")?.value as number
                        : 1;

                    result.map((e, i) => {
                        if (i >= num_results) return;
                        const filename = e.filename;
                        const episode = e.episode ? e.episode : "N/A";
                        const similarity = e.similarity;
                        const from = e.from;
                        const to = e.to;
                        const video = e.video;
                        const image = e.image;
                        const embedMsg = new EmbedBuilder()
                            .setTitle(filename)
                            .setURL(video)
                            .setDescription(`第 ${episode} 集, 
                                相似度：${similarity.toFixed(2)}%
                                時間：${(from/60).toFixed(0)}:${(from%60).toFixed(2)} - ${(to/60).toFixed(0)}:${(to%60).toFixed(2)}`)
                            .setImage(image)
                            .setTimestamp()
                            .setFooter({ text: `第 ${i + 1} 筆結果` });
                        embedarr.push(embedMsg);
                    });

                    await interaction.editReply({ embeds: embedarr });
                }
            })
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法搜尋動畫截圖" });
        }
    }
}