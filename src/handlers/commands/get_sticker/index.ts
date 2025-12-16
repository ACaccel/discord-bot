import { 
    MessageContextMenuCommandInteraction,
    EmbedBuilder,
    ApplicationCommandType,
    ContextMenuCommandType,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class get_sticker extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "get_sticker",
            description: "取得訊息中的貼圖 URL",
            type: ApplicationCommandType.Message as ContextMenuCommandType,
        });
    }

    public override async execute(interaction: MessageContextMenuCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const message = interaction.targetMessage;
            const stickers = message.stickers;

            if (stickers.size === 0) {
                await interaction.editReply({ content: "此訊息沒有貼圖" });
                return;
            }

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
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法取得貼圖" });
        }
    }
}
