import type {
    ContextMenuCommandType,
    UserContextMenuCommandInteraction} from 'discord.js';
import {
    EmbedBuilder,
    ApplicationCommandType
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';
export default class menu_get_avatar extends Command {
    constructor() {
        super();
        this.setConfig({
            // Stable ASCII id; the user-facing Discord name is resolved
            // from `commands:menu_get_avatar.name`.
            name: "menu_get_avatar",
            type: ApplicationCommandType.User as ContextMenuCommandType,
        });
    }

    public override async execute(interaction: UserContextMenuCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const user = interaction.targetUser;
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 1024 });

            const embed = new EmbedBuilder()
                .setTitle(bot.translator?.t('replies:menu_get_avatar.title', { user: user.username }) ?? '')
                .setColor(0x5865F2)
                .setImage(avatarUrl)
                .addFields({
                    name: bot.translator?.t('replies:menu_get_avatar.avatar_url_field') ?? '',
                    value: avatarUrl,
                });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await replyForError(interaction, bot, error, 'replies:menu_get_avatar.failed', interaction.guild?.id);
        }
    }
}
