import type { ChatInputCommandInteraction } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';
// deprecated, discord has added native pin permission
export default class pin_message extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'pin_message',
      category: 'admin',
      options: {
        string: [
          {
            name: 'action',
            required: true,
            choices: [
              { value: 'pin' },
              { value: 'unpin' },
            ],
          },
          {
            name: 'message_link',
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
        await replyForError(interaction, bot, error, 'replies:pin_message.failed', interaction.guild?.id);
    }
  }
}
