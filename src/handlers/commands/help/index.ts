import type { ChatInputCommandInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../../infra/discord/reply-for-error';

import { buildHelpEmbed } from './build-help-embed';

export default class help extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'help',
      category: 'utility',
    });
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
  ): Promise<void> {
    await interaction.deferReply();
    try {
      if (!bot.config.commands) {
        await interaction.editReply({
          content: bot.translator?.t('replies:help.no_commands') ?? '',
        });
        return;
      }

      const botUser = interaction.client.user;
      const embed = buildHelpEmbed(bot.commandHandlers, bot.translator, {
        botName: botUser?.username ?? '',
        botAvatarUrl: botUser?.displayAvatarURL(),
        intro: bot.helpMessage,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await replyForError(interaction, bot, error, 'replies:help.failed', interaction.guild?.id);
    }
  }
}
