import { ChannelType, ChatInputCommandInteraction } from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';

import { logError } from '@core/logger';
// deprecated, discord has added native pin permission
export default class pin_message extends Command {
  constructor() {
    super();
    this.setConfig({
      // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations / description_localizations.
      name: 'pin_message',
      // i18n-ignore: command-builder metadata; localised in PR 6-3.
      description: '釘選訊息',
      options: {
        string: [
          {
            name: 'action',
            // i18n-ignore: command-builder metadata; localised in PR 6-3.
            description: '釘選或取消釘選',
            required: true,
            choices: [
              // i18n-ignore: command-choice metadata; localised in PR 6-3.
              { name: '釘選', value: 'pin' },
              // i18n-ignore: command-choice metadata; localised in PR 6-3.
              { name: '取消釘選', value: 'unpin' },
            ],
          },
          {
            name: 'message_link',
            // i18n-ignore: command-builder metadata; localised in PR 6-3.
            description: '要釘選的訊息連結',
            required: true,
          },
        ],
      },
    });
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
  ): Promise<void> {
    await interaction.deferReply();
    const t = bot.translator;
    try {
      const act = interaction.options.get('action')?.value as string;
      const messageLink = interaction.options.get('message_link')?.value as string;
      const msgID = messageLink.split('/').pop() as string;

      if (!interaction.channel?.isThread()) {
        await interaction.editReply({ content: t?.t('replies:pin_message.not_in_thread') });
        return;
      }
      if (
        interaction.channel.type !== ChannelType.PublicThread ||
        interaction.user.id !== interaction.channel.ownerId
      ) {
        await interaction.editReply({
          content: t?.t('replies:pin_message.not_thread_owner'),
        });
        return;
      }

      if (act === 'unpin') {
        const msg = await interaction.channel.messages.fetch(msgID);
        if (msg) await msg.unpin();
        await interaction.editReply({ content: t?.t('replies:pin_message.unpinned') });
      } else if (act === 'pin') {
        const msg = await interaction.channel.messages.fetch(msgID);
        if (msg) await msg.pin();
        await interaction.editReply({ content: t?.t('replies:pin_message.pinned') });
      } else {
        await interaction.editReply({
          content: t?.t('replies:pin_message.invalid_action'),
        });
      }
    } catch (error) {
      logError(bot.logger, bot.clientId, interaction.guild?.id, error);
      await interaction.editReply({ content: t?.t('replies:pin_message.operation_failed') });
    }
  }
}
