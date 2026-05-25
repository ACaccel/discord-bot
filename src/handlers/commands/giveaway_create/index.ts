import type {
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import * as giveaway from '../../../plugins/giveaway/internal';

export default class giveaway_create extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "giveaway_create",
            options: {
                string: [
                    {
                        name: "duration",
                        required: true
                    },{
                        name: "prize",
                        required: true
                    },{
                        name: "description",
                        required: false
                    }
                ],
                number: [
                    {
                        name: "winner_num",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await giveaway.handleGiveawayCreate(interaction, bot);
    }
}