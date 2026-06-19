import type { ChatInputCommandInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import * as tempRole from '../../../plugins/temp-role/internal';
import { replyForError } from '../../reply-for-error';

export default class temp_role extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "temp_role",
            category: 'utility',
            options: {
                string: [
                    {
                        name: "name",
                        required: true
                    }
                ],
                number: [
                    {
                        name: "days",
                        required: false,
                        min: 1,
                        max: tempRole.MAX_TEMP_ROLE_DAYS
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        try {
            await tempRole.handleTempRoleCreate(interaction, bot);
        } catch (error) {
            await replyForError(interaction, bot, error, 'replies:temp_role.failed', interaction.guild?.id);
        }
    }
}
