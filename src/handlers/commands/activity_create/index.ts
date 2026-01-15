import {
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { activity } from '@features';

export default class activity_create extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "activity_create",
            description: "建立活動",
            options: {
                string: [
                    {
                        name: "title",
                        description: "活動標題",
                        required: true
                    },{
                        name: "duration",
                        description: "活動時限 (1s, 1m, 1h, 1d, 1w)",
                        required: true
                    },{
                        name: "description",
                        description: "活動描述 (optional)",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await activity.handleActivityCreate(interaction, bot as BaseBot & activity.IActivityBot);
    }
}
