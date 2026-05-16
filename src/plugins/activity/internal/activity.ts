import { GuildMember, EmbedBuilder, Channel } from 'discord.js';
import { Job } from 'node-schedule';
import { BaseBot } from '../../../bot';
import { bindTranslator } from '../../../core/i18n';
import { bot_cmd, JobManager, logger } from '../../../utils';

export interface IActivityBot {
    jobs: Map<string, Job>
}

export const isActivityBot = (bot: BaseBot) => {
    return (bot as BaseBot & IActivityBot).jobs !== undefined;
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
    bot: BaseBot,
) => {
    if (!channel.isSendable()) return null;

    const t = bindTranslator(bot.translator);

    const embed = new EmbedBuilder()
        .setTitle(t('replies:activity.announce_title', { title }))
        .addFields(
            { name: t('replies:activity.announce_field_id'), value: activity_id },
            { name: t('replies:activity.announce_field_description'), value: description || t('replies:common.empty_value') },
            { name: t('replies:activity.announce_field_endtime'), value: end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) },
        )
        .setColor("#00BFFF")
        .setFooter({ text: t('replies:activity.announce_footer') });

    const message = await channel.send({ embeds: [embed] });
    if (!message) return null;
    else {
        bot_cmd.msgReact(message, ['✅']);
        return message.id;
    }
}

export const findActivity = async (bot: BaseBot, guild_id: string, activity_id: string) => {
    if (!isActivityBot(bot)) return false;

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return false;
    }
    const repos = bot.guildInfo[guild.id]?.repos;
    if (!repos) {
        return false;
    }
    const activity = await repos.activity.findByActivityId(activity_id);
    if (!activity) return false;
    return true;
}

export const scheduleActivity = async (bot: BaseBot, guild_id: string, activity_id: string) => {
    if (!isActivityBot(bot)) return "Bot does not implement IActivityBot";

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return "Guild not found";
    }
    const repos = bot.guildInfo[guild.id]?.repos;
    if (!repos) {
        return "Database not found";
    }

    const activity = await repos.activity.findByActivityId(activity_id);
    if (!activity) return "Activity not found";
    const activityChannel = guild.channels.cache.get(activity.channel_id);
    if (!activityChannel?.isSendable()) return "Activity channel not found";

    const message = await activityChannel.messages.fetch(activity.message_id).catch(() => null);
    if (!message) return "Activity message not found";

    const reaction = message.reactions.cache.get("✅");
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
    const participantsArray = participantsMembers.map(m => m.id);

    // Update activity with participants
    await repos.activity.setParticipants(activity_id, participantsArray);

    // Send results
    const t = bindTranslator(bot.translator);
    const resultContent = participantsArray.length > 0
        ? t('replies:activity.result_with_participants', {
            title: activity.title,
            participants: participantsArray.map(id => `<@${id}>`).join('\n'),
            count: participantsArray.length,
        })
        : t('replies:activity.result_no_participants', { title: activity.title });
    await activityChannel.send({ content: resultContent });

    new JobManager(bot.jobs).cancel(activityJobKey(activity_id));

    return null;
}

export const deleteActivity = async (bot: BaseBot & IActivityBot, guild_id: string, activity_id: string) => {
    if (!isActivityBot(bot)) return "Bot does not implement IActivityBot";

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return "Guild not found";
    }
    const repos = bot.guildInfo[guild.id]?.repos;
    if (!repos) {
        return "Database not found";
    }

    new JobManager(bot.jobs).cancel(activityJobKey(activity_id));
    await repos.activity.deleteByActivityId(activity_id);

    return null;
}

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

export const rebootActivityJobs = async (bot: BaseBot) => {
    const jobManager = new JobManager(bot.jobs);
    await Promise.all(
        Object.values(bot.guildInfo).map(async (guild_info) => {
            try {
                if (!guild_info.repos) return;
                const activities = await rebootRetry(() => guild_info.repos!.activity.listAll());
                for (const a of activities) {
                    // Per-row try/catch so a transient Mongo blip on a
                    // single delete does not abort the rest of the
                    // guild's scheduling pass (reviewer WARN: previous
                    // shape left the remainder un-scheduled). Errors
                    // are logged but not escalated — the listAll
                    // exhaustion path below is the operator-visible
                    // failure mode.
                    try {
                        const expired_at = new Date(a.expired_at);
                        if (expired_at > new Date()) {
                            jobManager.schedule(activityJobKey(a.activity_id), expired_at, async () => {
                                if (await findActivity(bot, guild_info.guild.id, a.activity_id)) {
                                    await scheduleActivity(bot, guild_info.guild.id, a.activity_id);
                                }
                            });
                        } else {
                            await rebootRetry(() =>
                                deleteActivity(bot as BaseBot & IActivityBot, guild_info.guild.id, a.activity_id),
                            );
                        }
                    } catch (rowErr) {
                        logger.errorLogger(bot.clientId, guild_info.guild.id, rowErr);
                    }
                }
            } catch (err) {
                // listAll exhaustion: log + surface to operators via
                // the debug channel so a sustained outage is visible,
                // not just buried in the log file.
                logger.errorLogger(bot.clientId, guild_info.guild.id, err);
                const debugCh = guild_info.channels?.debug;
                if (debugCh?.isSendable()) {
                    await debugCh
                        .send(
                            `[ ops ] activity reboot listAll failed for guild ${guild_info.guild.id} after ${REBOOT_MAX_ATTEMPTS} attempts; scheduled jobs may be missing until next restart.`,
                        )
                        .catch((sendErr) =>
                            logger.errorLogger(bot.clientId, guild_info.guild.id, sendErr),
                        );
                }
            }
        }),
    );

    return null;
}
