import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';
import { parseIds } from './parse-ids';
import { buildMemberDescription, type TFn } from './format-member-fields';

const MAX_IDS_PER_RUN = 20;

export default class inspect_member_ids extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'inspect_member_ids',
      options: {
        string: [{ name: 'ids', required: true }],
      },
    });
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
  ): Promise<void> {
    await interaction.deferReply();
    const t: TFn = (key, params) => bot.translator?.t(key, params) ?? '';
    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({ content: t('errors:command.guild_info_not_found') });
        return;
      }

      const allIds = parseIds(interaction.options.getString('ids', true));
      if (allIds.length === 0) {
        await interaction.editReply({ content: t('replies:inspect_member_ids.no_valid_id') });
        return;
      }

      const ids = allIds.slice(0, MAX_IDS_PER_RUN);
      const droppedCount = allIds.length - ids.length;
      const embeds: EmbedBuilder[] = [];

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as string;
        const member = await guild.members.fetch(id).catch(() => null);
        const fetchedUser = member?.user ?? (await bot.client.users.fetch(id).catch(() => null));
        const user = fetchedUser ? await fetchedUser.fetch(true).catch(() => fetchedUser) : null;

        embeds.push(
          new EmbedBuilder()
            .setTitle(t('replies:inspect_member_ids.title', { current: i + 1, total: ids.length }))
            .setColor(member ? 0x57f287 : 0xed4245)
            .setDescription(buildMemberDescription(id, user, member, t))
            .setFooter({ text: `${guild.name}｜in guild: ${member ? 'yes' : 'no'}` }),
        );
      }

      const first = embeds.shift();
      if (!first) {
        await interaction.editReply({ content: t('replies:inspect_member_ids.embed_failed') });
        return;
      }
      await interaction.editReply({
        content:
          droppedCount > 0
            ? t('replies:inspect_member_ids.exceeds_max', {
                max: MAX_IDS_PER_RUN,
                dropped: droppedCount,
              })
            : undefined,
        embeds: [first],
      });
      for (const embed of embeds) {
        await interaction.followUp({ embeds: [embed] });
      }
    } catch (error) {
      await replyForError(
        interaction,
        bot,
        error,
        'replies:inspect_member_ids.failed',
        interaction.guild?.id,
      );
    }
  }
}
