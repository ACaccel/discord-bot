import { GuildMember, EmbedBuilder, Channel } from 'discord.js';
import { Job } from 'node-schedule';
import { BaseBot } from '../../../bot';
import { bot_cmd, JobManager, logger } from '../../../utils';

export interface IGiveawayBot {
    jobs: Map<string, Job>
}

export const isGiveawayBot = (bot: BaseBot) => {
    return (bot as BaseBot & IGiveawayBot).jobs !== undefined;
}

export const giveawayJobKey = (message_id: string) => `giveaway:${message_id}`;

export const isGiveawayJobKey = (key: string, messageId: string) =>
    key.startsWith('giveaway:') && key.split(':')[1] === messageId;

export const giveawayAnnouncement = async (
    channel: Channel,
    prize: string,
    prize_owner_id: string,
    winner_num: number,
    end_time_date: Date,
    description: string,
    bot: BaseBot,
) => {
    if (!channel.isSendable()) return null;

    const t = (key: string, params?: Record<string, string | number>): string =>
        bot.translator?.t(key, params) ?? '';

    const embed = new EmbedBuilder()
        .setTitle(t('replies:giveaway.announce_title', { prize }))
        .addFields(
            { name: t('replies:giveaway.announce_field_owner'), value: `<@${prize_owner_id}>` },
            { name: t('replies:giveaway.announce_field_winners'), value: winner_num.toString() },
            { name: t('replies:giveaway.announce_field_endtime'), value: end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) },
            { name: t('replies:giveaway.announce_field_description'), value: description || t('replies:giveaway.empty_value') }
        )
        .setColor("#F9F900")
        .setFooter({ text: t('replies:giveaway.announce_footer') });

    const message = await channel.send({ embeds: [embed] });
    if (!message) return null;
    else {
        bot_cmd.msgReact(message, ['🎉']);
        return message.id;
    }
}

export const findGiveaway = async (bot: BaseBot, guild_id: string, message_id: string) => {
    if (!isGiveawayBot(bot)) return false;

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return false;
    }
    const repos = bot.guildInfo[guild.id]?.repos;
    if (!repos) {
        return false;
    }
    const giveaway = await repos.giveaway.findByMessageId(message_id);
    if (!giveaway) return false;
    return true;
}

export const scheduleGiveaway = async (bot: BaseBot, guild_id: string, message_id: string) => {
    if (!isGiveawayBot(bot)) return "Bot does not implement IGiveawayBot";

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return "Guild not found";
    }
    const repos = bot.guildInfo[guild.id]?.repos;
    if (!repos) {
        return "Database not found";
    }

    const giveaway = await repos.giveaway.findByMessageId(message_id);
    if (!giveaway) return "Giveaway not found";
    const giveawayChannel = guild.channels.cache.get(giveaway.channel_id);
    if (!giveawayChannel?.isSendable()) return "Giveaway channel not found";

    const message = await giveawayChannel.messages.fetch(message_id).catch(() => null);
    if (!message) return "Giveaway message not found";

    const reaction = message.reactions.cache.get("🎉");
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
    const participantsArray = participantsMembers;

    // Select winners
    let winners: GuildMember[] = [];
    if (participantsArray.length > 0) {
        const shuffled = [...participantsArray].sort(() => 0.5 - Math.random());
        winners = shuffled.slice(0, Math.min(giveaway.winner_num, shuffled.length));
    }

    // Send results
    const t = (key: string, params?: Record<string, string | number>): string =>
        bot.translator?.t(key, params) ?? '';
    const resultContent = winners.length > 0
        ? t('replies:giveaway.result_with_winners', {
            prize: giveaway.prize,
            winners: winners.map(w => `<@${w.id}>`).join('\n'),
            ownerId: giveaway.prize_owner_id,
        })
        : t('replies:giveaway.result_no_participants', { prize: giveaway.prize });
    await giveawayChannel.send({ content: resultContent });

    await repos.giveaway.deleteByMessageId(message_id);
    new JobManager(bot.jobs).cancel(giveawayJobKey(message_id));

    return null;
}

export const deleteGiveaway = async (bot: BaseBot & IGiveawayBot, guild_id: string, message_id: string) => {
    if (!isGiveawayBot(bot)) return "Bot does not implement IGiveawayBot";

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return "Guild not found";
    }
    const repos = bot.guildInfo[guild.id]?.repos;
    if (!repos) {
        return "Database not found";
    }

    new JobManager(bot.jobs).cancel(giveawayJobKey(message_id));
    await repos.giveaway.deleteByMessageId(message_id);

    return null;
}

/**
 * Same exponential-backoff retry as `activity.rebootRetry`. Audit C-1
 * reviewer follow-up — a transient Mongo blip during boot used to
 * silently leave the guild's scheduled giveaways un-rebuilt for the
 * process lifetime.
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

export const rebootGiveawayJobs = async (bot: BaseBot) => {
    const jobManager = new JobManager(bot.jobs);
    await Promise.all(
        Object.values(bot.guildInfo).map(async (guild_info) => {
            try {
                if (!guild_info.repos) return;
                const giveaways = await rebootRetry(() => guild_info.repos!.giveaway.listAll());
                for (const g of giveaways) {
                    // Per-row try/catch so one transient Mongo blip on
                    // a delete does not abort the remaining giveaways.
                    try {
                        const end_time = new Date(g.end_time);
                        if (end_time > new Date()) {
                            jobManager.schedule(giveawayJobKey(g.message_id), end_time, async () => {
                                if (await findGiveaway(bot, guild_info.guild.id, g.message_id)) {
                                    await scheduleGiveaway(bot, guild_info.guild.id, g.message_id);
                                }
                            });
                        } else {
                            await rebootRetry(() =>
                                deleteGiveaway(bot, guild_info.guild.id, g.message_id),
                            );
                        }
                    } catch (rowErr) {
                        logger.errorLogger(bot.clientId, guild_info.guild.id, rowErr);
                    }
                }
            } catch (err) {
                logger.errorLogger(bot.clientId, guild_info.guild.id, err);
                const debugCh = guild_info.channels?.debug;
                if (debugCh?.isSendable()) {
                    await debugCh
                        .send(
                            `[ ops ] giveaway reboot listAll failed for guild ${guild_info.guild.id} after ${REBOOT_MAX_ATTEMPTS} attempts; scheduled jobs may be missing until next restart.`,
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