import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class change_nickname extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "change_nickname",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "更改bot暱稱",
            options: {
                string: [
                    {
                        name: "nickname",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "新暱稱",
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
    
            await interaction.editReply({ content: `已更改暱稱為：${newName}` });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:change_nickname.failed') ?? ''});
        }
    }
}