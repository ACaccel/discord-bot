import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

import type { BaseBot } from '../../../bot';
import { bindTranslator } from '../../../core/i18n';
import { logError } from '../../../core/logger';
import { JobManager, parseDuration } from '@core/scheduling';
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
    // Reply ephemerally so the acknowledgement (and any validation
    // error) is visible only to the invoker. On the success path the
    // deferred reply is deleted, leaving the announcement embed as the
    // only visible output.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

        // The giveaway is published directly in the channel the command
        // was invoked from — there is no dedicated `giveaway` channel
        // to configure.
        const channel = interaction.channel;
        if (!channel?.isSendable()) {
            await interaction.editReply({ content: t('errors:command.channel_not_found') });
            return;
        }

        const repos = deps.registry.getRepos(guild.id);
        if (!repos) {
            await interaction.editReply({ content: t('errors:db.not_found') });
            return;
        }

        const durationMs = parseDuration(duration);
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

        // `create` returns Result<GiveawayDoc, DatabaseError>. An
        // `err` is re-thrown into the surrounding catch. `channel_id`
        // records the invoking channel so the reboot path
        // (`scheduleGiveaway`) re-resolves the same channel when it
        // announces the result.
        const createResult = await repos.giveaway.create({
            winner_num,
            prize,
            end_time,
            channel_id: channel.id,
            prize_owner_id: interaction.user.id,
            participants: [],
            message_id,
        });
        if (!createResult.ok) throw createResult.error;

        if (await findGiveaway(deps, guild.id, message_id)) {
            new JobManager(deps.jobMap).schedule(
                giveawayJobKey(message_id),
                end_time_date,
                () => scheduleGiveaway(deps, guild.id, message_id),
            );
        }

        // No success reply — the announcement embed is the only
        // intended output, so remove the ephemeral acknowledgement.
        await interaction.deleteReply();
    } catch (error) {
        logError(bot.logger, interaction.guild?.id ?? null, error);
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
        logError(bot.logger, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: t('replies:giveaway.delete_failed') });
    }
};
