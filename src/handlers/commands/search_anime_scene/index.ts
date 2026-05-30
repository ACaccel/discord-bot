import type { 
    ChatInputCommandInteraction} from 'discord.js';
import {
    EmbedBuilder,
} from 'discord.js';
import axios from 'axios';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';
export default class search_anime_scene extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "search_anime_scene",
            category: 'utility',
            options: {
                attachment: [
                    {
                        name: "image",
                        required: true
                    }
                ],
                number: [
                    {
                        name: "display_num",
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
                await interaction.editReply({ content: bot.translator?.t('replies:search_anime_scene.upload_image') ?? '' });
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
                    const embedarr: EmbedBuilder[] = [];
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
                            .setDescription(bot.translator?.t('replies:search_anime_scene.description', {
                                episode,
                                similarity: similarity.toFixed(2),
                                fromMin: (from / 60).toFixed(0),
                                fromSec: (from % 60).toFixed(2),
                                toMin: (to / 60).toFixed(0),
                                toSec: (to % 60).toFixed(2),
                            }) ?? '')
                            .setImage(image)
                            .setTimestamp()
                            .setFooter({ text: bot.translator?.t('replies:search_anime_scene.footer', { index: i + 1 }) ?? '' });
                        embedarr.push(embedMsg);
                    });

                    await interaction.editReply({ embeds: embedarr });
                }
            })
        } catch (error) {
            await replyForError(interaction, bot, error, 'replies:search_anime_scene.failed', interaction.guild?.id);
        }
    }
}