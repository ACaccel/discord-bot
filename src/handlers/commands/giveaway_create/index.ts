import type { ChatInputCommandInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { buildGiveawayModal } from './build-giveaway-modal';

export default class giveaway_create extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'giveaway_create',
      category: 'server_activity',
    });
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
  ): Promise<void> {
    // The giveaway parameters are collected through a modal rather
    // than slash-command options; the submitted modal is handled by
    // the `giveaway_create` modal handler.
    await interaction.showModal(buildGiveawayModal(bot.translator));
  }
}
