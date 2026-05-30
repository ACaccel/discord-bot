import type {
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import * as giveaway from '../../../plugins/giveaway/internal';

export default class giveaway_delete extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "giveaway_delete",
            category: 'server_activity',
            options: {
                string: [
                    {
                        name: "message_id",
                        required: true
                    }
                ]
            }       
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await giveaway.handleGiveawayDelete(interaction, bot);
    }
}