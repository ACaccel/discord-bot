/**
 * The body both per-user traffic commands run: `/traffic_me` (subject =
 * the invoker) and `/traffic_user` (subject = a specified target). Only
 * the subject resolution and the i18n key prefix differ, so the guards,
 * the visibility filter, the aggregation, and the reply assembly live
 * here and each command file is left with its option declaration.
 *
 * Privacy is gated by the INVOKER, never the subject: the visible-channel
 * set is built from the invoker's clearance plus their native
 * `ViewChannel` permission, and the subject's activity is counted only
 * within it. A subject with no visible activity — including one not in
 * the guild — yields the same neutral no-data reply, so the command
 * never reveals a restricted channel or whether a user is a member.
 */
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { MessageFlags } from 'discord.js';

import type { BaseBot } from '@bot';

import { replyForError } from '../../../infra/discord/reply-for-error';

import { aggregateUserTraffic } from './aggregation-user';
import { readTrafficOptions } from './options';
import type { TFn } from './types';
import { buildUserTrafficView, type TrafficStatsKeyPrefix } from './user-view';
import { buildAllowedChannelSet } from './visibility-filter';
import { resolveWindow } from './window';

/** Whose activity is counted, and under which name it is rendered. */
interface UserTrafficSubject {
  readonly id: string;
  readonly displayName: string;
}

interface UserTrafficCommandSpec {
  /** Command name; doubles as the `replies:<name>.*` key prefix. */
  readonly command: TrafficStatsKeyPrefix;
  /**
   * Pick the subject. Receives the invoker's already-fetched member so
   * the self case needs no second Discord round trip.
   */
  readonly resolveSubject: (
    interaction: ChatInputCommandInteraction,
    invoker: GuildMember,
  ) => UserTrafficSubject;
}

export const runUserTrafficCommand = async (
  interaction: ChatInputCommandInteraction,
  bot: BaseBot,
  spec: UserTrafficCommandSpec,
): Promise<void> => {
  const t: TFn = (key, params) => bot.translator?.t(key, params) ?? '';
  // Read options before deferring: ephemerality is fixed at defer time.
  const options = readTrafficOptions(interaction);
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
    // decide which channels are visible — never the counted user's.
    const member = await guild.members.fetch(interaction.user.id);
    const allowed = buildAllowedChannelSet({
      guild,
      member,
      policy,
      mode: options.visibility,
      commandChannelId: interaction.channelId,
    });

    // Aggregation subject, counted only within `allowed`.
    const subject = spec.resolveSubject(interaction, member);

    const window = resolveWindow(options.range, Date.now());
    const aggregate = await aggregateUserTraffic(repos, window, allowed, subject.id);
    if (aggregate.userTotal === 0) {
      await interaction.editReply({ content: t(`replies:${spec.command}.no_data`) });
      return;
    }

    const view = buildUserTrafficView(
      aggregate,
      options.topN,
      options.range,
      subject.displayName,
      guild,
      t,
      spec.command,
    );
    await interaction.editReply({ embeds: view.embeds, files: view.files });
  } catch (error) {
    await replyForError(
      interaction,
      bot,
      error,
      `replies:${spec.command}.failed`,
      interaction.guild?.id,
    );
  }
};
