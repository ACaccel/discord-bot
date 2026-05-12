import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class emoji_frequency extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "emoji_frequency",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "統計表情符號使用頻率",
            options: {
                string: [
                    {
                        name: "frequency",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "頻率順序 (optional)",
                        required: false,
                        choices: [
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "前n低頻率", value: "asc" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "前n高頻率", value: "desc" }
                        ]
                    },{
                        name: "type",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "動態或靜態 (optional)",
                        required: false,
                        choices: [
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "動態", value: "animated" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "靜態", value: "static" }
                        ]
                    }
                ],
                number: [
                    {
                        name: "top_n",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "前n名 (optional, max: 30)",
                        required: false
                    },{
                        name: "last_n_months",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
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
                await interaction.editReply({ content: bot.translator?.t('errors:command.guild_not_found') ?? '' });
                return;
            }
            const db = bot.guildInfo[guild.id].db;
            if (!db) {
                await interaction.editReply({ content: bot.translator?.t('errors:db.not_configured') ?? '' });
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
                await interaction.editReply({ content: bot.translator?.t('replies:emoji_frequency.progress', { current: monthOffset + 1, total: last_n_months }) ?? '' });
            }
    
            allEmoji.forEach((_, emojiText) => {
                allEmoji.set(emojiText, (textEmoji.get(emojiText) || 0) + (reactionEmoji.get(emojiText) || 0));
            });
            const sortedEmojis = Array.from(allEmoji.entries())
                .filter(([emoji]) => type === "animated" ? emoji.startsWith("<a:") : emoji.startsWith("<:"))
                .sort((a, b) => frequency === "asc" ? a[1] - b[1] : b[1] - a[1])
                .slice(0, top_n);
    
            const t = (key: string, params?: Record<string, string | number>): string =>
                bot.translator?.t(key, params) ?? '';
            const direction = frequency === "asc"
                ? t('replies:emoji_frequency.direction_lowest')
                : t('replies:emoji_frequency.direction_highest');
            const kind = type === "animated"
                ? t('replies:emoji_frequency.kind_animated')
                : t('replies:emoji_frequency.kind_static');
            let content = t('replies:emoji_frequency.header', { months: last_n_months, direction, top: top_n, kind });
            for (let i = 0; i < sortedEmojis.length; i++) {
                const [emoji, _] = sortedEmojis[i];
                content += t('replies:emoji_frequency.line', {
                    rank: i + 1,
                    emoji,
                    total: allEmoji.get(emoji) ?? 0,
                    text: textEmoji.get(emoji) ?? 0,
                    reaction: reactionEmoji.get(emoji) ?? 0,
                });
                
                // Send every 10 emojis or at the end
                if ((i + 1) % 10 === 0 || i === sortedEmojis.length - 1) {
                    await interaction.followUp({ content });
                    content = "";
                }
            }
            
            if (content === "") {
                await interaction.editReply({ content: bot.translator?.t('replies:emoji_frequency.done') ?? '' });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:emoji_frequency.failed') ?? '' });
        }
    }
}