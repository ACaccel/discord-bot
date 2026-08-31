import type { ModalSubmitInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { ModalHandler } from '@modal';

import * as giveaway from '../../../plugins/giveaway/internal';

export default class giveaway_create_modal extends ModalHandler {
  public override async execute(interaction: ModalSubmitInteraction, bot: BaseBot): Promise<void> {
    await giveaway.handleGiveawayCreate(interaction, bot);
  }
}
