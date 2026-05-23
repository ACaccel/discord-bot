import type {
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command, localizeCommandConfig } from '@cmd';

import { replyForError } from '../../reply-for-error';

export default class help extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'help',
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
                    // Descriptions are i18n keys resolved here against
                    // the `commands` catalog, keeping CJK literals out
                    // of source.
                    const localized = localizeCommandConfig(cmd.config, bot.translator);
                    helpContent += `* \`/${localized.name}\` : ${localized.description}\n`;
                }
            });

            await interaction.editReply({ content: helpContent });
        } catch (error) {
            await replyForError(interaction, bot, error, 'replies:help.failed', interaction.guild?.id);
        }
    }
}
