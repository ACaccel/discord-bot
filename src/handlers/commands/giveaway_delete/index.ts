import {
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { giveaway } from '@features';

export default class giveaway_delete extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "giveaway_delete",
            description: "刪除抽獎",
            options: {
                string: [
                    {
                        name: "message_id",
                        description: "抽獎訊息ID (Bot發布的公告)",
                        required: true
                    }
                ]
            }       
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await giveaway.handleGiveawayDelete(interaction, bot as BaseBot & giveaway.IGiveawayBot);
    }
}