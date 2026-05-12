import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class help extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'help',
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: '顯示指令清單與說明',
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            if (!bot.config.commands) {
                await interaction.editReply({ content: bot.translator?.t('replies:help.no_commands') ?? ''});
                return;
            }

            let  helpContent = '## Help Message\n';
            helpContent += bot.help_msg;
            helpContent += bot.translator?.t('replies:help.commands_header') ?? '';
            bot.commandHandlers.forEach((cmd) => {
                if (cmd.config) {
                    helpContent += `* \`/${cmd.config.name}\` : ${cmd.config.description}\n`;
                }
            });

            await interaction.editReply({ content: helpContent });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:help.failed') ?? ''});
        }
    }
}