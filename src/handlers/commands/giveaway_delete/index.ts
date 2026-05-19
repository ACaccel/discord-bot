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
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "刪除抽獎",
            options: {
                string: [
                    {
                        name: "message_id",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "抽獎訊息ID (Bot發布的公告)",
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