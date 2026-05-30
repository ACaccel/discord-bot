import type { ChatInputCommandInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';
import { clampOptions } from './clamp-options';
import { accumulateEmojiCounts, initEmojiCounts, type EmojiCounts } from './aggregate-emoji-counts';
import { rankEmoji } from './rank-emoji';
import { formatLeaderboard, type TFn } from './format-leaderboard';

export default class emoji_frequency extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'emoji_frequency',
      category: 'utility',
      options: {
        string: [
          {
            name: 'frequency',
            required: false,
            choices: [{ value: 'asc' }, { value: 'desc' }],
          },
          {
            name: 'type',
            required: false,
            choices: [{ value: 'animated' }, { value: 'static' }],
          },
        ],
        number: [
          { name: 'top_n', required: false },
          { name: 'last_n_months', required: false },
        ],
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
        await interaction.editReply({ content: t('errors:command.guild_not_found') });
        return;
      }
      const repos = bot.getRepos(guild.id);
      if (!repos) {
        await interaction.editReply({ content: t('errors:db.not_configured') });
        return;
      }

      const type = ((interaction.options.get('type')?.value as string) ?? 'static') as
        | 'animated'
        | 'static';
      const frequency = ((interaction.options.get('frequency')?.value as string) ?? 'asc') as
        | 'asc'
        | 'desc';
      const { topN, lastNMonths } = clampOptions({
        topN: (interaction.options.get('top_n')?.value as number) ?? 5,
        lastNMonths: (interaction.options.get('last_n_months')?.value as number) ?? 1,
      });

      const guildEmojiTexts: string[] = [];
      guild.emojis.cache.forEach((emoji) => {
        guildEmojiTexts.push(`<${emoji.animated ? 'a:' : ':'}${emoji.name}:${emoji.id}>`);
      });
      const counts: EmojiCounts = initEmojiCounts(guildEmojiTexts);

      // Process messages month by month to avoid heap pressure.
      for (let monthOffset = 0; monthOffset < lastNMonths; monthOffset++) {
        const monthStart = new Date();
        monthStart.setMonth(monthStart.getMonth() - monthOffset - 1);
        const monthEnd = new Date();
        monthEnd.setMonth(monthEnd.getMonth() - monthOffset);
        // A repo `err` is re-thrown into the surrounding catch.
        const messagesResult = await repos.message.findByTimestampRange(
          monthStart.getTime(),
          monthEnd.getTime(),
        );
        if (!messagesResult.ok) throw messagesResult.error;
        accumulateEmojiCounts(messagesResult.value, counts);
        await interaction.editReply({
          content: t('replies:emoji_frequency.progress', {
            current: monthOffset + 1,
            total: lastNMonths,
          }),
        });
      }

      const ranked = rankEmoji(counts, { type, frequency, topN });
      const direction =
        frequency === 'asc'
          ? t('replies:emoji_frequency.direction_lowest')
          : t('replies:emoji_frequency.direction_highest');
      const kind =
        type === 'animated'
          ? t('replies:emoji_frequency.kind_animated')
          : t('replies:emoji_frequency.kind_static');
      const pages = formatLeaderboard(ranked, { months: lastNMonths, direction, topN, kind }, t);

      if (pages.length === 0) {
        await interaction.editReply({ content: t('replies:emoji_frequency.done') });
        return;
      }
      for (const page of pages) {
        await interaction.followUp({ content: page });
      }
    } catch (error) {
      await replyForError(
        interaction,
        bot,
        error,
        'replies:emoji_frequency.failed',
        interaction.guild?.id,
      );
    }
  }
}
