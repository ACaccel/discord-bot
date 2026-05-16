import { 
    ChatInputCommandInteraction,
    MessageFlags,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';

import { logError } from '@core/logger';
export default class bug_report extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "bug_report",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "回報問題",
            options: {
                string: [
                    {
                        name: "content",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "問題描述",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        try {
            let content = interaction.options.get("content")?.value as string;
            if (!content) {
                await interaction.reply({ content: bot.translator?.t('replies:bug_report.empty_content') ?? '', flags: MessageFlags.Ephemeral });
                return;
            }
    
            if (!bot.adminId) {
                throw new Error("Admin ID not found");
            }
    
            // send message to admin via dm
            const admin = await bot.client.users.fetch(bot.adminId);
            if (admin) {
                await admin.send(`Bug Report from ${interaction.user.username}：${content}`);
                await interaction.reply({ content: bot.translator?.t('replies:bug_report.reported', { content }) ?? '', flags: MessageFlags.Ephemeral });
            } else {
                throw new Error("Admin not found");
            }
        } catch (error) {
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: bot.translator?.t('replies:bug_report.failed') ?? '', flags: MessageFlags.Ephemeral });
        }
    }
}