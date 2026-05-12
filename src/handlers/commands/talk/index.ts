import {
    ChatInputCommandInteraction,
    Guild,
    MessageFlags,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class talk extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "talk",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "讓機器人說話",
            options: {
                channel: [
                    {
                        name: "channel",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "選擇頻道",
                        required: true
                    }
                ],
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
            let ch = interaction.options.get("channel")?.value as string;
            let content = interaction.options.get("content")?.value as string;
            if (!ch || !content) {
                await interaction.reply({ content: bot.translator?.t('replies:talk.missing_args') ?? '', flags: MessageFlags.Ephemeral });
                return;
            }
            
            // check existance of channel
            let guild = interaction.guild as Guild;
            let channel = guild.channels.cache.get(ch);
            if (!channel?.isSendable()) {
                await interaction.reply({ content: bot.translator?.t('errors:command.channel_not_sendable') ?? '', flags: MessageFlags.Ephemeral });
                return;
            }
            
            // avoid to tag everyone
            await interaction.deferReply();
            await interaction.deleteReply();
            if (content.includes("@everyone") || content.includes("@here")) {
                const tagMessage = bot.translator?.t('replies:talk.tag_warning', { user: interaction.user.username }) ?? '';
                await channel.send(tagMessage);
            } else {
                await channel.send(content);
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: bot.translator?.t('replies:talk.send_failed') ?? '', flags: MessageFlags.Ephemeral });
        }
    }
}