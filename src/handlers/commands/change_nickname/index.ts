import type { 
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';
export default class change_nickname extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "change_nickname",
            options: {
                string: [
                    {
                        name: "nickname",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const guild = interaction.guild;
            if (!guild) {
                await interaction.editReply({ content: bot.translator?.t('errors:command.guild_not_found') ?? ''});
                return;
            }
    
            const newName = interaction.options.get("nickname")?.value as string;
            const userBot = guild.members.cache.get(bot.client.user?.id as string);
            if (!userBot) {
                await interaction.editReply({ content: bot.translator?.t('errors:command.bot_not_found') ?? ''});
                return;
            }
            await userBot.setNickname(newName);
    
            await interaction.editReply({ content: bot.translator?.t('replies:change_nickname.changed', { newName }) ?? '' });
        } catch (error) {
            await replyForError(interaction, bot, error, 'replies:change_nickname.failed', interaction.guild?.id);
        }
    }
}