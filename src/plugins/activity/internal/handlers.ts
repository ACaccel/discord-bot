import type { ChatInputCommandInteraction } from 'discord.js';

import type { BaseBot } from '../../../bot';
import { bindTranslator } from '../../../core/i18n';
import { logError } from '../../../core/logger';
import { JobManager, parseDuration } from '@core/scheduling';
import {
    activityAnnouncement,
    activityJobKey,
    deleteActivity,
    findActivity,
    scheduleActivity,
} from './activity';
import { buildActivityDepsFromBot } from './deps-from-bot';

export const handleActivityCreate = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
): Promise<void> => {
    await interaction.deferReply();
    const t = bindTranslator(bot.translator);
    const deps = buildActivityDepsFromBot(bot);
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

        const repos = deps.registry.getRepos(guild.id);
        if (!repos) {
            await interaction.editReply({ content: t('errors:db.not_found') });
            return;
        }

        const durationMs = parseDuration(duration);
        if (durationMs === null) {
            await interaction.editReply({ content: t('replies:activity.invalid_duration') });
            return;
        }

        const current_time = Date.now();
        const end_time = current_time + durationMs;
        const end_time_date = new Date(end_time);

        const activity_id = current_time.toString();
        const message_id = await activityAnnouncement(
            activity_id,
            channel,
            title,
            description || t('replies:common.empty_value'),
            end_time_date,
            deps,
        );
        if (!message_id) {
            await interaction.editReply({ content: t('replies:activity.create_announce_failed') });
            return;
        }

        // G-2: create returns Result<ActivityDoc, DatabaseError>. An
        // `err` is re-thrown into the surrounding catch.
        const createResult = await repos.activity.create({
            activity_id,
            message_id,
            title,
            description: description || "",
            expired_at: end_time,
            channel_id: channel.id,
            participants: [],
        });
        if (!createResult.ok) throw createResult.error;

        if (await findActivity(deps, guild.id, activity_id)) {
            new JobManager(deps.jobMap).schedule(
                activityJobKey(activity_id),
                end_time_date,
                () => scheduleActivity(deps, guild.id, activity_id),
            );
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
    bot: BaseBot,
): Promise<void> => {
    await interaction.deferReply();
    const t = bindTranslator(bot.translator);
    const deps = buildActivityDepsFromBot(bot);
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

        const result = await deleteActivity(deps, guild.id, activity_id);
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
