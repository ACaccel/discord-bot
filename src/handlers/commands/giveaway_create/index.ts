import {
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { giveaway } from '@features';

export default class giveaway_create extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "giveaway_create",
            description: "建立抽獎",
            options: {
                string: [
                    {
                        name: "duration",
                        description: "抽獎時限 (1s, 1m, 1h, 1d, 1w)",
                        required: true
                    },{
                        name: "prize",
                        description: "獎品",
                        required: true
                    },{
                        name: "description",
                        description: "抽獎描述 (optional)",
                        required: false
                    }
                ],
                number: [
                    {
                        name: "winner_num",
                        description: "中獎人數",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await giveaway.handleGiveawayCreate(interaction, bot as BaseBot & giveaway.IGiveawayBot);
    }
}