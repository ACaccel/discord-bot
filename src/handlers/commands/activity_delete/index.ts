import {
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { activity } from '@features';

export default class activity_delete extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "activity_delete",
            description: "刪除活動",
            options: {
                string: [
                    {
                        name: "activity_id",
                        description: "活動ID",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await activity.handleActivityDelete(interaction, bot as BaseBot & activity.IActivityBot);
    }
}
