/**
 * Activity reboot + scheduling internals.
 *
 * Audit ARCH-BLOCK3 (PR-G4): the public surface now takes a typed
 * {@link ActivityDeps} bundle instead of the whole `BaseBot`, so the
 * plugin can resolve its dependencies through the IoC container
 * (`ctx.resolve(...)`) rather than receiving a callback that closes
 * over the composition root's `this`. Composition roots no longer
 * deep-import this file.
 *
 * The legacy slash-command handlers still hold a `BaseBot` reference;
 * they call {@link buildActivityDepsFromBot} to bridge into the new
 * surface without changing the handler signature.
 */
import type { Client, GuildMember, Channel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import type { Job } from 'node-schedule';

import type { GuildRegistry } from '../../../core/guild-registry';
import { bindTranslator } from '../../../core/i18n';
import type { Translator } from '../../../core/i18n';
import { logError, type Logger } from '../../../core/logger';
import type { Message } from 'discord.js';

import { JobManager } from '@core/scheduling';

const msgReact = async (
  logger: Logger,
  msg: Message,
  reactions: readonly string[],
): Promise<void> => {
  if (!msg || reactions.length === 0) return;
  for (const reaction of reactions) {
    try {
      await msg.react(reaction);
    } catch (error) {
      // G-1: route through the structured logger instead of raw
      // console.error so reaction failures are observable.
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          messageId: msg.id,
          reaction,
        },
        'failed to add reaction to activity announcement message',
      );
    }
  }
};

/**
 * Typed dependency bundle for every activity-plugin operation. Built
 * once in `createActivityPlugin.onReady` from `ctx.resolve(...)`, or
 * by {@link buildActivityDepsFromBot} when a slash-command handler
 * holds the legacy `BaseBot` reference.
 */
export interface ActivityDeps {
  readonly client: Client;
  readonly registry: GuildRegistry;
  readonly jobMap: Map<string, Job>;
  readonly logger: Logger;
  readonly clientId: string;
  readonly translator: Translator | undefined;
}

export const activityJobKey = (activity_id: string) => `activity:${activity_id}`;

export const isActivityJobKey = (key: string, activityId: string) =>
  key.startsWith('activity:') && key.split(':')[1] === activityId;

export const activityAnnouncement = async (
  activity_id: string,
  channel: Channel,
  title: string,
  description: string,
  end_time_date: Date,
  deps: ActivityDeps,
) => {
  if (!channel.isSendable()) return null;

  const t = bindTranslator(deps.translator);

  const embed = new EmbedBuilder()
    .setTitle(t('replies:activity.announce_title', { title }))
    .addFields(
      { name: t('replies:activity.announce_field_id'), value: activity_id },
      {
        name: t('replies:activity.announce_field_description'),
        value: description || t('replies:common.empty_value'),
      },
      {
        name: t('replies:activity.announce_field_endtime'),
        value: end_time_date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      },
    )
    .setColor('#00BFFF')
    .setFooter({ text: t('replies:activity.announce_footer') });

  const message = await channel.send({ embeds: [embed] });
  if (!message) return null;
  else {
    void msgReact(deps.logger, message, ['✅']);
    return message.id;
  }
};

export const findActivity = async (deps: ActivityDeps, guild_id: string, activity_id: string) => {
  const guild = deps.client.guilds.cache.get(guild_id);
  if (!guild) return false;
  const repos = deps.registry.getRepos(guild_id);
  if (!repos) return false;
  // G-2: repo methods return Result<T, DatabaseError>. An `err` is
  // re-thrown so the caller's surrounding catch handles it exactly as
  // the pre-G-2 raw-error propagation did.
  const result = await repos.activity.findByActivityId(activity_id);
  if (!result.ok) throw result.error;
  return result.value !== undefined && result.value !== null;
};

export const scheduleActivity = async (
  deps: ActivityDeps,
  guild_id: string,
  activity_id: string,
) => {
  const guild = deps.client.guilds.cache.get(guild_id);
  if (!guild) return 'Guild not found';
  const repos = deps.registry.getRepos(guild_id);
  if (!repos) return 'Database not found';

  // G-2: an `err` is re-thrown for the caller's surrounding catch.
  const activityResult = await repos.activity.findByActivityId(activity_id);
  if (!activityResult.ok) throw activityResult.error;
  const activity = activityResult.value;
  if (!activity) return 'Activity not found';
  const activityChannel = guild.channels.cache.get(activity.channel_id);
  if (!activityChannel?.isSendable()) return 'Activity channel not found';

  const message = await activityChannel.messages.fetch(activity.message_id).catch(() => null);
  if (!message) return 'Activity message not found';

  const reaction = message.reactions.cache.get('✅');
  const users = await reaction?.users.fetch().catch(() => null);

  const participantsMembers: GuildMember[] = [];
  if (users) {
    for (const [, user] of users) {
      if (user.bot) continue;
      const member = guild.members.cache.get(user.id);
      if (member) {
        participantsMembers.push(member);
      }
    }
  }
  const participantsArray = participantsMembers.map((m) => m.id);

  const setResult = await repos.activity.setParticipants(activity_id, participantsArray);
  if (!setResult.ok) throw setResult.error;

  const t = bindTranslator(deps.translator);
  const resultContent =
    participantsArray.length > 0
      ? t('replies:activity.result_with_participants', {
          title: activity.title,
          participants: participantsArray.map((id) => `<@${id}>`).join('\n'),
          count: participantsArray.length,
        })
      : t('replies:activity.result_no_participants', { title: activity.title });
  await activityChannel.send({ content: resultContent });

  new JobManager(deps.jobMap).cancel(activityJobKey(activity_id));
  return null;
};

export const deleteActivity = async (deps: ActivityDeps, guild_id: string, activity_id: string) => {
  const guild = deps.client.guilds.cache.get(guild_id);
  if (!guild) return 'Guild not found';
  const repos = deps.registry.getRepos(guild_id);
  if (!repos) return 'Database not found';

  new JobManager(deps.jobMap).cancel(activityJobKey(activity_id));
  // G-2: an `err` is re-thrown for the caller's surrounding catch.
  const deleteResult = await repos.activity.deleteByActivityId(activity_id);
  if (!deleteResult.ok) throw deleteResult.error;
  return null;
};

/**
 * Retry helper. Exponential backoff: 250ms → 500ms → 1000ms before
 * giving up. Audit C-1 reviewer follow-up — the reboot loop used to
 * log-and-continue on a transient Mongo blip, silently leaving the
 * guild's scheduled jobs un-rebuilt for the lifetime of the process.
 */
const REBOOT_MAX_ATTEMPTS = 3;
const rebootRetry = async <T>(op: () => Promise<T>): Promise<T> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < REBOOT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (attempt < REBOOT_MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
};

export const rebootActivityJobs = async (deps: ActivityDeps): Promise<void> => {
  const jobManager = new JobManager(deps.jobMap);
  await Promise.all(
    deps.registry.listGuildIds().map(async (guildId) => {
      try {
        const repos = deps.registry.getRepos(guildId);
        if (!repos) return;
        // G-2: listAll returns Result<T, DatabaseError>. Throw the `err`
        // inside the retried op so `rebootRetry`'s backoff still treats a
        // transient DB failure as retryable, exactly as before G-2.
        const activities = await rebootRetry(async () => {
          const result = await repos.activity.listAll();
          if (!result.ok) throw result.error;
          return result.value;
        });
        for (const a of activities) {
          try {
            const expired_at = new Date(a.expired_at);
            if (expired_at > new Date()) {
              jobManager.schedule(activityJobKey(a.activity_id), expired_at, async () => {
                if (await findActivity(deps, guildId, a.activity_id)) {
                  await scheduleActivity(deps, guildId, a.activity_id);
                }
              });
            } else {
              await rebootRetry(() => deleteActivity(deps, guildId, a.activity_id));
            }
          } catch (rowErr) {
            logError(deps.logger, deps.clientId, guildId, rowErr);
          }
        }
      } catch (err) {
        logError(deps.logger, deps.clientId, guildId, err);
        const debugCh = deps.registry.getChannel(guildId, 'debug');
        if (debugCh?.isSendable()) {
          await debugCh
            .send(
              `[ ops ] activity reboot listAll failed for guild ${guildId} after ${REBOOT_MAX_ATTEMPTS} attempts; scheduled jobs may be missing until next restart.`,
            )
            .catch((sendErr) => logError(deps.logger, deps.clientId, guildId, sendErr));
        }
      }
    }),
  );
};
