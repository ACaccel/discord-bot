import type { 
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import { misc } from '@utils';

import { replyForError } from '../../reply-for-error';
export default class sticker_frequency extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "sticker_frequency",
            options: {
                string: [
                    {
                        name: "frequency",
                        required: false,
                        choices: [
                            { value: "asc" },
                            { value: "desc" }
                        ]
                    }
                ],
                number: [
                    {
                        name: "top_n",
                        required: false
                    },{
                        name: "last_n_months",
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
                await interaction.editReply({ content: bot.translator?.t('errors:command.guild_not_found') ?? '' });
                return;
            }
            const repos = bot.guildInfo[guild.id]?.repos;
            if (!repos) {
                await interaction.editReply({ content: bot.translator?.t('errors:db.not_configured') ?? '' });
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
                
                // G-2: an `err` is re-thrown into the surrounding catch.
                const messagesResult = await repos.message.findByTimestampRange(
                    monthStart.getTime(),
                    monthEnd.getTime(),
                );
                if (!messagesResult.ok) throw messagesResult.error;
                const messages = messagesResult.value;

                messages.forEach((message) => {
                    const stickers = message.stickers ?? [];
                    stickers.forEach((sticker) => {
                        const name = sticker.name;
                        if (typeof name === 'string' && stickerMap.has(name)) {
                            stickerMap.set(name, (stickerMap.get(name) ?? 0) + 1);
                        }
                    });
                });
                
                // update progress
                await interaction.editReply({ content: bot.translator?.t('replies:sticker_frequency.progress', { current: monthOffset + 1, total: last_n_months }) ?? '' });
            }

            const sortedStickers = Array.from(stickerMap.entries())
                .sort((a, b) => frequency === "asc" ? a[1] - b[1] : b[1] - a[1])
                .slice(0, top_n);

            const t = (key: string, params?: Record<string, string | number>): string =>
                bot.translator?.t(key, params) ?? '';
            const direction = frequency === "asc"
                ? t('replies:sticker_frequency.direction_lowest')
                : t('replies:sticker_frequency.direction_highest');
            let content = t('replies:sticker_frequency.header', { months: last_n_months, direction, top: top_n });
            sortedStickers.forEach(([sticker, count], index) => {
                content += t('replies:sticker_frequency.line', { rank: index + 1, sticker, count });
            });

            // create a preview image
            const canvasContent: misc.CanvasContent[] = [];
            for (let i = 0; i < sortedStickers.length; i++) {
                const [stickerName, count] = sortedStickers[i] as [string, number];
                const sticker = guild.stickers.cache.find(s => s.name === stickerName);
                if (sticker) {
                    canvasContent.push({
                        url: sticker.url,
                        text: t('replies:sticker_frequency.chart_label', { rank: i + 1, count }),
                    });
                }
            }
            const attachment = await misc.listInOneImage(canvasContent);
    
            await interaction.editReply({ content: content, files: attachment ? [attachment] : [] });
        } catch (error) {
            await replyForError(interaction, bot, error, 'replies:sticker_frequency.failed', interaction.guild?.id);
        }
    }
}