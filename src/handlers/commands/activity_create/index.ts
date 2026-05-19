import type {
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import * as activity from '../../../plugins/activity/internal';

export default class activity_create extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "activity_create",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "建立活動",
            options: {
                string: [
                    {
                        name: "title",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "活動標題",
                        required: true
                    },{
                        name: "duration",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "活動時限 (1s, 1m, 1h, 1d, 1w)",
                        required: true
                    },{
                        name: "description",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "活動描述 (optional)",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await activity.handleActivityCreate(interaction, bot);
    }
}
