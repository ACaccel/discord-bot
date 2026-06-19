import type { StringSelectMenuInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { SSMHandler } from '@select-menu';

import * as giveaway from '../../../plugins/giveaway/internal';

export default class giveaway_delete extends SSMHandler {
    public override async execute(interaction: StringSelectMenuInteraction, bot: BaseBot): Promise<void> {
        await giveaway.handleGiveawayDeleteSelection(interaction, bot);
    }
}
