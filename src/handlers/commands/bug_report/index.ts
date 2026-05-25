import type { 
    ChatInputCommandInteraction} from 'discord.js';
import {
    MessageFlags,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';
export default class bug_report extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "bug_report",
            options: {
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
            const content = interaction.options.get("content")?.value as string;
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
            await replyForError(interaction, bot, error, 'replies:bug_report.failed', interaction.guild?.id);
        }
    }
}