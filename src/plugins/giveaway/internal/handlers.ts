import {
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '../../../bot';
import { bindTranslator } from '../../../core/i18n';
import { logger, misc, JobManager } from '../../../utils';
import {
    giveawayAnnouncement,
    findGiveaway,
    scheduleGiveaway,
    IGiveawayBot,
    giveawayJobKey,
} from './giveaway';

export const handleGiveawayCreate = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot & IGiveawayBot,
): Promise<void> => {
    await interaction.deferReply();
    const t = bindTranslator(bot.translator);
    try {
        const duration = interaction.options.get("duration")?.value as string | null;
        const winner_num = interaction.options.get("winner_num")?.value as number | null;
        const prize = interaction.options.get("prize")?.value as string | null;
        const description = interaction.options.get("description")?.value as string | null;

        if (!duration || !winner_num || !prize) {
            await interaction.editReply({ content: t('replies:giveaway.missing_required_fields') });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: t('errors:command.guild_not_found') });
            return;
        }

        const channel_id = bot.guildInfo[guild.id].channels?.giveaway?.id;
        if (!channel_id) {
            await interaction.editReply({ content: t('replies:giveaway.channel_not_configured') });
            return;
        }

        const channel = interaction.guild.channels.cache.get(channel_id);
        if (!channel?.isSendable()) {
            await interaction.editReply({ content: t('errors:command.channel_not_found') });
            return;
        }

        const repos = bot.guildInfo[guild.id]?.repos;
        if (!repos) {
            await interaction.editReply({ content: t('errors:db.not_found') });
            return;
        }

        // parse duration
        const durationMs = misc.parseDuration(duration);
        if (durationMs === null) {
            await interaction.editReply({ content: t('replies:giveaway.invalid_duration') });
            return;
        }

        const current_time = Date.now();
        const end_time = current_time + durationMs;
        const end_time_date = new Date(end_time);

        // create giveaway announcement
        const message_id = await giveawayAnnouncement(
            channel,
            prize,
            interaction.user.id,
            winner_num,
            end_time_date,
            description || t('replies:common.empty_value'),
            bot,
        );
        if (!message_id) {
            await interaction.editReply({ content: t('replies:giveaway.create_announce_failed') });
            return;
        }

        // save giveaway to database
        await repos.giveaway.create({
            winner_num,
            prize,
            end_time,
            channel_id: channel.id,
            prize_owner_id: interaction.user.id,
            participants: [],
            message_id,
        });

        // schedule job to find winner
        if (await findGiveaway(bot, guild.id, message_id)) {
            new JobManager(bot.jobs).schedule(giveawayJobKey(message_id), end_time_date, () => scheduleGiveaway(bot, guild.id, message_id));
        }

        await interaction.editReply({
            content: t('replies:giveaway.create_success', {
                endTime: end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
            }),
        });
    } catch (error) {
        logger.errorLogger(bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: t('replies:giveaway.create_failed') });
    }
};

export const handleGiveawayDelete = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot & IGiveawayBot,
): Promise<void> => {
    await interaction.deferReply();
    const t = bindTranslator(bot.translator);
    try {
        const message_id = interaction.options.get("message_id")?.value as string | null;
        if (!message_id) {
            await interaction.editReply({ content: t('replies:giveaway.missing_message_id') });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: t('errors:command.guild_not_found') });
            return;
        }

        const result = await import('./giveaway').then(m => m.deleteGiveaway(bot, guild.id, message_id));
        if (typeof result === 'string' && result !== null) {
            await interaction.editReply({
                content: t('replies:giveaway.delete_failed_with_reason', { reason: result }),
            });
            return;
        }

        await interaction.editReply({ content: t('replies:giveaway.delete_success') });
    } catch (error) {
        logger.errorLogger(bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: t('replies:giveaway.delete_failed') });
    }
};
