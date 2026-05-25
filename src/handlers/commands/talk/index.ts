import type {
    ChatInputCommandInteraction,
    Guild} from 'discord.js';
import {
    MessageFlags,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';
export default class talk extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "talk",
            options: {
                channel: [
                    {
                        name: "channel",
                        required: true
                    }
                ],
                string: [
                    {
                        name: "content",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        try {
            const ch = interaction.options.get("channel")?.value as string;
            const content = interaction.options.get("content")?.value as string;
            if (!ch || !content) {
                await interaction.reply({ content: bot.translator?.t('replies:talk.missing_args') ?? '', flags: MessageFlags.Ephemeral });
                return;
            }
            
            // check existance of channel
            const guild = interaction.guild as Guild;
            const channel = guild.channels.cache.get(ch);
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
            await replyForError(interaction, bot, error, 'replies:talk.failed', interaction.guild?.id);
        }
    }
}