/**
 * Giveaway reboot + scheduling internals.
 *
 * Audit ARCH-BLOCK3 (PR-G4): the public surface now takes a typed
 * {@link GiveawayDeps} bundle instead of the whole `BaseBot`, so the
 * plugin can resolve its dependencies through the IoC container
 * (`ctx.resolve(...)`) rather than receiving a callback that closes
 * over the composition root's `this`. Composition roots no longer
 * deep-import this file.
 *
 * The legacy slash-command handlers still hold a `BaseBot` reference;
 * they call {@link buildGiveawayDepsFromBot} to bridge into the new
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

import { JobManager } from '../../../utils/job_manager';

const msgReact = async (msg: Message, reactions: readonly string[]): Promise<void> => {
    if (!msg || reactions.length === 0) return;
    for (const reaction of reactions) {
        try {
            await msg.react(reaction);
        } catch (error) {
            console.error(`Failed to react with ${reaction} on message ${msg.id}:`, error);
        }
    }
};

export interface GiveawayDeps {
    readonly client: Client;
    readonly registry: GuildRegistry;
    readonly jobMap: Map<string, Job>;
    readonly logger: Logger;
    readonly clientId: string;
    readonly translator: Translator | undefined;
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
    deps: GiveawayDeps,
) => {
    if (!channel.isSendable()) return null;

    const t = bindTranslator(deps.translator);

    const embed = new EmbedBuilder()
        .setTitle(t('replies:giveaway.announce_title', { prize }))
        .addFields(
            { name: t('replies:giveaway.announce_field_owner'), value: `<@${prize_owner_id}>` },
            { name: t('replies:giveaway.announce_field_winners'), value: winner_num.toString() },
            { name: t('replies:giveaway.announce_field_endtime'), value: end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) },
            { name: t('replies:giveaway.announce_field_description'), value: description || t('replies:common.empty_value') },
        )
        .setColor("#F9F900")
        .setFooter({ text: t('replies:giveaway.announce_footer') });

    const message = await channel.send({ embeds: [embed] });
    if (!message) return null;
    else {
        void msgReact(message, ['🎉']);
        return message.id;
    }
};

export const findGiveaway = async (deps: GiveawayDeps, guild_id: string, message_id: string) => {
    const guild = deps.client.guilds.cache.get(guild_id);
    if (!guild) return false;
    const repos = deps.registry.getRepos(guild_id);
    if (!repos) return false;
    const giveaway = await repos.giveaway.findByMessageId(message_id);
    return giveaway !== undefined && giveaway !== null;
};

export const scheduleGiveaway = async (deps: GiveawayDeps, guild_id: string, message_id: string) => {
    const guild = deps.client.guilds.cache.get(guild_id);
    if (!guild) return "Guild not found";
    const repos = deps.registry.getRepos(guild_id);
    if (!repos) return "Database not found";

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

    let winners: GuildMember[] = [];
    if (participantsArray.length > 0) {
        const shuffled = [...participantsArray].sort(() => 0.5 - Math.random());
        winners = shuffled.slice(0, Math.min(giveaway.winner_num, shuffled.length));
    }

    const t = bindTranslator(deps.translator);
    const resultContent = winners.length > 0
        ? t('replies:giveaway.result_with_winners', {
            prize: giveaway.prize,
            winners: winners.map((w) => `<@${w.id}>`).join('\n'),
            ownerId: giveaway.prize_owner_id,
        })
        : t('replies:giveaway.result_no_participants', { prize: giveaway.prize });
    await giveawayChannel.send({ content: resultContent });

    await repos.giveaway.deleteByMessageId(message_id);
    new JobManager(deps.jobMap).cancel(giveawayJobKey(message_id));
    return null;
};

export const deleteGiveaway = async (deps: GiveawayDeps, guild_id: string, message_id: string) => {
    const guild = deps.client.guilds.cache.get(guild_id);
    if (!guild) return "Guild not found";
    const repos = deps.registry.getRepos(guild_id);
    if (!repos) return "Database not found";

    new JobManager(deps.jobMap).cancel(giveawayJobKey(message_id));
    await repos.giveaway.deleteByMessageId(message_id);
    return null;
};

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

export const rebootGiveawayJobs = async (deps: GiveawayDeps): Promise<void> => {
    const jobManager = new JobManager(deps.jobMap);
    await Promise.all(
        deps.registry.listGuildIds().map(async (guildId) => {
            try {
                const repos = deps.registry.getRepos(guildId);
                if (!repos) return;
                const giveaways = await rebootRetry(() => repos.giveaway.listAll());
                for (const g of giveaways) {
                    try {
                        const end_time = new Date(g.end_time);
                        if (end_time > new Date()) {
                            jobManager.schedule(giveawayJobKey(g.message_id), end_time, async () => {
                                if (await findGiveaway(deps, guildId, g.message_id)) {
                                    await scheduleGiveaway(deps, guildId, g.message_id);
                                }
                            });
                        } else {
                            await rebootRetry(() => deleteGiveaway(deps, guildId, g.message_id));
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
                            `[ ops ] giveaway reboot listAll failed for guild ${guildId} after ${REBOOT_MAX_ATTEMPTS} attempts; scheduled jobs may be missing until next restart.`,
                        )
                        .catch((sendErr) =>
                            logError(deps.logger, deps.clientId, guildId, sendErr),
                        );
                }
            }
        }),
    );
};
