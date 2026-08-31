import type { ChatInputCommandInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import { listInOneImage, type CanvasContent } from '../discord-helpers';

import { replyForError } from '../../../infra/discord/reply-for-error';
import { getOptionalNumber, getOptionalString } from '../../../infra/discord/options';
import { tallyStickerUsage } from './tally-stickers';
export default class sticker_frequency extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'sticker_frequency',
      category: 'utility',
      options: {
        string: [
          {
            name: 'frequency',
            required: false,
            choices: [{ value: 'asc' }, { value: 'desc' }],
          },
        ],
        number: [
          {
            name: 'top_n',
            required: false,
          },
          {
            name: 'last_n_months',
            required: false,
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
    try {
      const frequency = getOptionalString(interaction, 'frequency') ?? 'asc';
      // Clamp to at least 1: the command declares no minimum for
      // these options, and 0 would render an empty chart.
      let top_n = Math.max(1, getOptionalNumber(interaction, 'top_n') ?? 5);
      let last_n_months = Math.max(1, getOptionalNumber(interaction, 'last_n_months') ?? 1);
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({
          content: bot.translator?.t('errors:command.guild_not_found') ?? '',
        });
        return;
      }
      const repos = bot.getRepos(guild.id);
      if (!repos) {
        await interaction.editReply({
          content: bot.translator?.t('errors:db.not_configured') ?? '',
        });
        return;
      }

      if (top_n > 30) top_n = 30;
      if (last_n_months > 24) last_n_months = 24;

      // A repo `err` inside the tally is re-thrown into the catch below.
      const stickerMap = await tallyStickerUsage(
        repos,
        guild.stickers.cache.map((sticker) => sticker.name),
        last_n_months,
        async (monthsDone) => {
          await interaction.editReply({
            content:
              bot.translator?.t('replies:sticker_frequency.progress', {
                current: monthsDone,
                total: last_n_months,
              }) ?? '',
          });
        },
      );

      const sortedStickers = Array.from(stickerMap.entries())
        .sort((a, b) => (frequency === 'asc' ? a[1] - b[1] : b[1] - a[1]))
        .slice(0, top_n);

      const t = (key: string, params?: Record<string, string | number>): string =>
        bot.translator?.t(key, params) ?? '';
      const direction =
        frequency === 'asc'
          ? t('replies:sticker_frequency.direction_lowest')
          : t('replies:sticker_frequency.direction_highest');
      let content = t('replies:sticker_frequency.header', {
        months: last_n_months,
        direction,
        top: top_n,
      });
      sortedStickers.forEach(([sticker, count], index) => {
        content += t('replies:sticker_frequency.line', { rank: index + 1, sticker, count });
      });

      // create a preview image
      const canvasContent: CanvasContent[] = [];
      for (const [i, [stickerName, count]] of sortedStickers.entries()) {
        const sticker = guild.stickers.cache.find((s) => s.name === stickerName);
        if (sticker) {
          canvasContent.push({
            url: sticker.url,
            text: t('replies:sticker_frequency.chart_label', { rank: i + 1, count }),
          });
        }
      }
      const attachment = await listInOneImage(canvasContent);

      await interaction.editReply({ content: content, files: attachment ? [attachment] : [] });
    } catch (error) {
      await replyForError(
        interaction,
        bot,
        error,
        'replies:sticker_frequency.failed',
        interaction.guild?.id,
      );
    }
  }
}
