import type {
    ChatInputCommandInteraction} from 'discord.js';
import {
    MessageFlags,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { logError } from '@core/logger';
export default class talk_signed extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "talk_signed",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "讓機器人說話(署名)",
            options: {
                string: [
                    {
                        name: "content",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "就是內容",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        try {
            const content = interaction.options.get("content")?.value as string;
            if (!content) {
                await interaction.reply({ content: bot.translator?.t('replies:talk_signed.missing_args') ?? '', flags: MessageFlags.Ephemeral });
                return;
            }
            
            // check existance of channel and member
            const channel = interaction.channel;
            if (!channel?.isSendable()) {
                await interaction.reply({ content: bot.translator?.t('errors:command.channel_not_sendable') ?? '', flags: MessageFlags.Ephemeral });
                return;
            }
            const guild_member = interaction.member && 'displayName' in interaction.member ? interaction.member : null;
            if (!guild_member) {
                await interaction.reply({ content: bot.translator?.t('replies:talk_signed.member_not_found') ?? '', flags: MessageFlags.Ephemeral });
                return;
            }
            
            // avoid to tag everyone
            await interaction.deferReply();
            await interaction.deleteReply();
            if (content.includes("@everyone") || content.includes("@here")) {
                const tagMessage = bot.translator?.t('replies:talk_signed.tag_warning', { displayName: guild_member.displayName, username: interaction.user.username }) ?? '';
                await channel.send(tagMessage);
            } else {
                await channel.send(`${guild_member.displayName}(${interaction.user.username}): ${content}`);
            }
        } catch (error) {
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: bot.translator?.t('replies:talk_signed.send_failed') ?? '', flags: MessageFlags.Ephemeral });
        }
    }
}