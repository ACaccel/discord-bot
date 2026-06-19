import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';

import { aggregateUserTraffic } from '../traffic-shared/aggregation-user';
import { readTrafficStatsOptions } from '../traffic-shared/options';
import type { TFn } from '../traffic-shared/types';
import { buildUserTrafficView } from '../traffic-shared/user-view';
import { buildAllowedChannelSet } from '../traffic-shared/visibility-filter';
import { resolveWindow } from '../traffic-shared/window';

/**
 * `/traffic_user` — a specified target user's message-activity stats over
 * a time window: an overview (total, daily average, share of visible
 * traffic, busiest period, rank among active users), a time-trend line
 * chart, and a channel-distribution bar chart.
 *
 * Privacy is gated by the INVOKER, never the target. The visible-channel
 * set is built from the invoker's clearance (`permission_rank`) plus their
 * native `ViewChannel` permission, and the target's activity is counted
 * only within it; the target's own clearance is irrelevant. A target with
 * no visible activity — including one not in the guild — yields the same
 * neutral no-data reply, so the command never reveals a restricted channel
 * or whether a user is a member. `visibility` mirrors `/traffic_me`
 * (default `ephemeral`): a `public` reply is additionally capped by the
 * command channel's rank.
 */
export default class traffic_user extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'traffic_user',
      category: 'server_activity',
      options: {
        user: [{ name: 'user', required: true }],
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
    const options = readTrafficStatsOptions(interaction);
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

      // Filter subject: the INVOKER. Their clearance + native ViewChannel
      // decide which channels are visible — never the target's.
      const member = await guild.members.fetch(interaction.user.id);
      const allowed = buildAllowedChannelSet({
        guild,
        member,
        policy,
        mode: options.visibility,
        commandChannelId: interaction.channelId,
      });

      // Aggregation subject: the TARGET, counted only within `allowed`.
      const target = interaction.options.getUser('user', true);
      const targetMember = interaction.options.getMember('user');
      const targetDisplayName =
        targetMember && 'displayName' in targetMember ? targetMember.displayName : target.username;

      const window = resolveWindow(options.range, Date.now());
      const aggregate = await aggregateUserTraffic(repos, window, allowed, target.id);
      if (aggregate.userTotal === 0) {
        await interaction.editReply({ content: t('replies:traffic_user.no_data') });
        return;
      }

      const view = buildUserTrafficView(
        aggregate,
        options.topN,
        options.range,
        targetDisplayName,
        guild,
        t,
        'traffic_user',
      );
      await interaction.editReply({ embeds: view.embeds, files: view.files });
    } catch (error) {
      await replyForError(
        interaction,
        bot,
        error,
        'replies:traffic_user.failed',
        interaction.guild?.id,
      );
    }
  }
}
