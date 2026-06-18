import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';

import type { TFn } from '../traffic-shared/types';
import { buildAllowedChannelSet } from '../traffic-shared/visibility-filter';
import { resolveWindow } from '../traffic-shared/window';

import { aggregateUserTraffic } from './aggregation-user';
import { readTrafficMeOptions } from './options';
import { buildTrafficMeView } from './view';

/**
 * `/traffic_me` — the invoker's personal message-activity stats over a
 * time window: an overview (total, daily average, share of visible
 * traffic, busiest period, rank among active users), a personal
 * time-trend line chart, and a personal channel-distribution bar chart.
 *
 * `visibility` mirrors `/traffic` (default `ephemeral`). Reuses the same
 * filter: a `public` reply is capped by both the invoker's clearance and
 * the command channel's rank (so a shared reply never exceeds the room's
 * level), while an `ephemeral` reply is capped by the invoker's clearance
 * alone. It thus sets both the ceiling and whether the reply is posted.
 */
export default class traffic_me extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'traffic_me',
      category: 'server_activity',
      options: {
        string: [
          {
            name: 'visibility',
            required: false,
            choices: [{ value: 'ephemeral' }, { value: 'public' }],
          },
          {
            name: 'range',
            required: false,
            choices: [{ value: '24h' }, { value: '7d' }, { value: '30d' }],
          },
        ],
        number: [{ name: 'top_n', required: false, min: 1, max: 25 }],
      },
    });
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
  ): Promise<void> {
    const t: TFn = (key, params) => bot.translator?.t(key, params) ?? '';
    // Read options before deferring: ephemerality is fixed at defer time.
    const options = readTrafficMeOptions(interaction);
    await interaction.deferReply(
      options.visibility === 'ephemeral' ? { flags: MessageFlags.Ephemeral } : {},
    );
    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({ content: t('errors:command.guild_not_found') });
        return;
      }
      const repos = bot.getRepos(guild.id);
      const policy = bot.permissionRankPolicy;
      if (!repos || !policy) {
        await interaction.editReply({ content: t('errors:db.not_configured') });
        return;
      }

      const member = await guild.members.fetch(interaction.user.id);
      const allowed = buildAllowedChannelSet({
        guild,
        member,
        policy,
        mode: options.visibility,
        commandChannelId: interaction.channelId,
      });

      const window = resolveWindow(options.range, Date.now());
      const aggregate = await aggregateUserTraffic(repos, window, allowed, interaction.user.id);
      if (aggregate.userTotal === 0) {
        await interaction.editReply({ content: t('replies:traffic_me.no_data') });
        return;
      }

      const view = buildTrafficMeView(
        aggregate,
        options.topN,
        options.range,
        member.displayName,
        guild,
        t,
      );
      await interaction.editReply({ embeds: view.embeds, files: view.files });
    } catch (error) {
      await replyForError(
        interaction,
        bot,
        error,
        'replies:traffic_me.failed',
        interaction.guild?.id,
      );
    }
  }
}
