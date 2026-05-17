import { 
    MessageContextMenuCommandInteraction,
    EmbedBuilder,
    ApplicationCommandType,
    ContextMenuCommandType,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';

import { logError } from '@core/logger';
export default class menu_get_sticker extends Command {
    constructor() {
        super();
        this.setConfig({
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            name: "取得表符/貼圖連結",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "取得訊息中的表符/貼圖連結 (單一表符或貼圖)",
            type: ApplicationCommandType.Message as ContextMenuCommandType,
        });
    }

    public override async execute(interaction: MessageContextMenuCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const message = interaction.targetMessage;
            const stickers = message.stickers;
            const content = message.content?.trim() || "";

            // Check for stickers first
            if (stickers.size > 0) {
                const embed = new EmbedBuilder()
                    .setTitle("Sticker URL")
                    .setColor(0x5865F2);

                stickers.forEach(sticker => {
                    embed.addFields({
                        name: sticker.name,
                        value: sticker.url
                    });
                });

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            // Check for single emoji in message content
            const emojiPattern = /^<a?:(\w+):(\d+)>$/;
            const emojiMatch = content.match(emojiPattern);

            if (emojiMatch) {
                const isAnimated = content.startsWith("<a:");
                const emojiName = emojiMatch[1];
                const emojiId = emojiMatch[2];
                const emojiUrl = isAnimated 
                    ? `https://cdn.discordapp.com/emojis/${emojiId}.gif`
                    : `https://cdn.discordapp.com/emojis/${emojiId}.png`;

                const embed = new EmbedBuilder()
                    .setTitle("Emoji URL")
                    .setColor(0x5865F2)
                    .addFields({
                        name: emojiName,
                        value: emojiUrl
                    });

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            // No stickers or emoji found
            await interaction.editReply({ content: bot.translator?.t('replies:menu_get_sticker.not_found') ?? '' });
        } catch (error) {
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:menu_get_sticker.failed') ?? '' });
        }
    }
}
