import type { ChatInputCommandInteraction } from 'discord.js';

import type { BaseBot } from '../../../bot';
import { bindTranslator } from '../../../core/i18n';
import { logError } from '../../../core/logger';
import { misc, JobManager } from '../../../utils';
import {
    deleteGiveaway,
    findGiveaway,
    giveawayAnnouncement,
    giveawayJobKey,
    scheduleGiveaway,
} from './giveaway';
import { buildGiveawayDepsFromBot } from './deps-from-bot';

export const handleGiveawayCreate = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
): Promise<void> => {
    await interaction.deferReply();
    const t = bindTranslator(bot.translator);
    const deps = buildGiveawayDepsFromBot(bot);
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

        const channel_id = deps.registry.getChannel(guild.id, 'giveaway')?.id;
        if (!channel_id) {
            await interaction.editReply({ content: t('replies:giveaway.channel_not_configured') });
            return;
        }

        const channel = interaction.guild.channels.cache.get(channel_id);
        if (!channel?.isSendable()) {
            await interaction.editReply({ content: t('errors:command.channel_not_found') });
            return;
        }

        const repos = deps.registry.getRepos(guild.id);
        if (!repos) {
            await interaction.editReply({ content: t('errors:db.not_found') });
            return;
        }

        const durationMs = misc.parseDuration(duration);
        if (durationMs === null) {
            await interaction.editReply({ content: t('replies:giveaway.invalid_duration') });
            return;
        }

        const current_time = Date.now();
        const end_time = current_time + durationMs;
        const end_time_date = new Date(end_time);

        const message_id = await giveawayAnnouncement(
            channel,
            prize,
            interaction.user.id,
            winner_num,
            end_time_date,
            description || t('replies:common.empty_value'),
            deps,
        );
        if (!message_id) {
            await interaction.editReply({ content: t('replies:giveaway.create_announce_failed') });
            return;
        }

        await repos.giveaway.create({
            winner_num,
            prize,
            end_time,
            channel_id: channel.id,
            prize_owner_id: interaction.user.id,
            participants: [],
            message_id,
        });

        if (await findGiveaway(deps, guild.id, message_id)) {
            new JobManager(deps.jobMap).schedule(
                giveawayJobKey(message_id),
                end_time_date,
                () => scheduleGiveaway(deps, guild.id, message_id),
            );
        }

        await interaction.editReply({
            content: t('replies:giveaway.create_success', {
                endTime: end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
            }),
        });
    } catch (error) {
        logError(bot.logger, bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: t('replies:giveaway.create_failed') });
    }
};

export const handleGiveawayDelete = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
): Promise<void> => {
    await interaction.deferReply();
    const t = bindTranslator(bot.translator);
    const deps = buildGiveawayDepsFromBot(bot);
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

        const result = await deleteGiveaway(deps, guild.id, message_id);
        if (typeof result === 'string' && result !== null) {
            await interaction.editReply({
                content: t('replies:giveaway.delete_failed_with_reason', { reason: result }),
            });
            return;
        }

        await interaction.editReply({ content: t('replies:giveaway.delete_success') });
    } catch (error) {
        logError(bot.logger, bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: t('replies:giveaway.delete_failed') });
    }
};
