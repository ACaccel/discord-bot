import {
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '../../../bot';
import { bindTranslator } from '../../../core/i18n';
import { misc, JobManager } from '../../../utils';
import {
    activityAnnouncement,
    findActivity,
    scheduleActivity,
    deleteActivity,
    IActivityBot,
    activityJobKey,
} from './activity';

import { logError } from '@core/logger';
export const handleActivityCreate = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot & IActivityBot,
): Promise<void> => {
    await interaction.deferReply();
    const t = bindTranslator(bot.translator);
    try {
        const title = interaction.options.get("title")?.value as string | null;
        const duration = interaction.options.get("duration")?.value as string | null;
        const description = interaction.options.get("description")?.value as string | null;

        if (!duration || !title) {
            await interaction.editReply({ content: t('replies:activity.missing_required_fields') });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: t('errors:command.guild_not_found') });
            return;
        }

        const channel = interaction.channel;
        if (!channel?.isSendable()) {
            await interaction.editReply({ content: t('errors:command.channel_not_sendable') });
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
            await interaction.editReply({ content: t('replies:activity.invalid_duration') });
            return;
        }

        const current_time = Date.now();
        const end_time = current_time + durationMs;
        const end_time_date = new Date(end_time);

        // create activity announcement
        const activity_id = current_time.toString(); // use timestamp as activity id
        const message_id = await activityAnnouncement(
            activity_id,
            channel,
            title,
            description || t('replies:common.empty_value'),
            end_time_date,
            bot,
        );
        if (!message_id) {
            await interaction.editReply({ content: t('replies:activity.create_announce_failed') });
            return;
        }

        // save activity to database
        await repos.activity.create({
            activity_id,
            message_id,
            title,
            description: description || "",
            expired_at: end_time,
            channel_id: channel.id,
            participants: [],
        });

        // schedule job to close activity
        if (await findActivity(bot, guild.id, activity_id)) {
            new JobManager(bot.jobs).schedule(activityJobKey(activity_id), end_time_date, () => scheduleActivity(bot, guild.id, activity_id));
        }

        await interaction.editReply({
            content: t('replies:activity.create_success', {
                activityId: activity_id,
                endTime: end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
            }),
        });
    } catch (error) {
        logError(bot.logger, bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: t('replies:activity.create_failed') });
    }
};

export const handleActivityDelete = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot & IActivityBot,
): Promise<void> => {
    await interaction.deferReply();
    const t = bindTranslator(bot.translator);
    try {
        const activity_id = interaction.options.get("activity_id")?.value as string | null;
        if (!activity_id) {
            await interaction.editReply({ content: t('replies:activity.missing_activity_id') });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: t('errors:command.guild_not_found') });
            return;
        }

        const result = await deleteActivity(bot, guild.id, activity_id);
        if (typeof result === 'string' && result !== null) {
            await interaction.editReply({
                content: t('replies:activity.delete_failed_with_reason', { reason: result }),
            });
            return;
        }

        await interaction.editReply({ content: t('replies:activity.delete_success') });
    } catch (error) {
        logError(bot.logger, bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: t('replies:activity.delete_failed') });
    }
};
