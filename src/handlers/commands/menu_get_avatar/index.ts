import {
    EmbedBuilder,
    ApplicationCommandType,
    ContextMenuCommandType,
    UserContextMenuCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class menu_get_avatar extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "取得用戶頭像連結",
            description: "取得用戶的頭像 URL",
            type: ApplicationCommandType.User as ContextMenuCommandType,
        });
    }

    public override async execute(interaction: UserContextMenuCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const user = interaction.targetUser;
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 1024 });

            const embed = new EmbedBuilder()
                .setTitle(`${user.username} 的頭像 URL`)
                .setColor(0x5865F2)
                .setImage(avatarUrl)
                .addFields({
                    name: "頭像連結",
                    value: avatarUrl
                });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法取得用戶頭像" });
        }
    }
}
