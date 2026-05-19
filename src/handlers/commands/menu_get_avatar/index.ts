import type {
    ContextMenuCommandType,
    UserContextMenuCommandInteraction} from 'discord.js';
import {
    EmbedBuilder,
    ApplicationCommandType
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { logError } from '@core/logger';
export default class menu_get_avatar extends Command {
    constructor() {
        super();
        this.setConfig({
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            name: "取得用戶頭像連結",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
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
                .setTitle(bot.translator?.t('replies:menu_get_avatar.title', { user: user.username }) ?? '')
                .setColor(0x5865F2)
                .setImage(avatarUrl)
                .addFields({
                    name: bot.translator?.t('replies:menu_get_avatar.avatar_url_field') ?? '',
                    value: avatarUrl,
                });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:menu_get_avatar.failed') ?? '' });
        }
    }
}
