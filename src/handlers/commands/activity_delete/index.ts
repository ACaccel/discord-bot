import type {
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import * as activity from '../../../plugins/activity/internal';

export default class activity_delete extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "activity_delete",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "刪除活動",
            options: {
                string: [
                    {
                        name: "activity_id",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
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
