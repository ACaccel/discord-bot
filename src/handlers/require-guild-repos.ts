import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    ModalSubmitInteraction,
    StringSelectMenuInteraction,
} from 'discord.js';
import { DiscordAPIError, MessageFlags } from 'discord.js';
import type { BaseBot } from '@bot';

import { asGuildId } from '../core/ids';
import { ops } from '../core/logger';
import type { Repos } from '../persistence/repositories';

import { logSystem } from '@core/logger';
/**
 * Interactions that can both be replied/edited to.
 *
 * This helper centralises the null-check-then-reply guard every handler
 * needs, and folds in the disabled-guild distinction so operators see a
 * useful message instead of a generic `errors:db.not_found`.
 */
type RepliableHandlerInteraction =
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction
    | ContextMenuCommandInteraction;

/**
 * Discord error codes that mean "the interaction is dead, replying
 * again will just rejection-spam". See discord.js docs / Discord API
 * gateway-error reference. We never bubble these — surfacing them to
 * the dispatcher's outer catch only triggers another doomed reply.
 */
const EXPIRED_INTERACTION_CODES: ReadonlySet<number> = new Set([
    10062, // Unknown Interaction (>3s window elapsed)
    40060, // Interaction has already been acknowledged
]);

const replyOrEdit = async (
    bot: BaseBot,
    interaction: RepliableHandlerInteraction,
    content: string,
): Promise<void> => {
    if (content.length === 0) return;
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content });
            return;
        }
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (err) {
        if (err instanceof DiscordAPIError && EXPIRED_INTERACTION_CODES.has(Number(err.code))) {
            // The interaction is gone. Log once and swallow — there is
            // nothing else we can tell the user, and re-throwing would
            // just walk into the dispatcher's catch and try the same
            // reply again. The structured log preserves the trail.
            logSystem(bot.logger, ops.router.replySkipped(err.code));
            return;
        }
        throw err;
    }
};

/**
 * Resolve the guild's `Repos` bundle or reply to the user with the
 * most accurate error message available and return null.
 *
 * Returns `null` (not `undefined`) so the caller can use an
 * unambiguous early-return guard:
 *
 * ```ts
 * const repos = await requireGuildRepos(bot, interaction);
 * if (repos === null) return;
 * ```
 *
 * The helper is the only place that knows about the
 * {@link BaseBot.connectionManager}'s disabled-guild set; handlers
 * stay ignorant of the transient/persistent split and only see the
 * resolved `Repos` (or an already-sent reply).
 */
export const requireGuildRepos = async (
    bot: BaseBot,
    interaction: RepliableHandlerInteraction,
): Promise<Repos | null> => {
    const guildId = interaction.guild?.id;
    if (guildId === undefined) {
        await replyOrEdit(
            bot,
            interaction,
            bot.translator?.t('errors:command.guild_only') ?? '',
        );
        return null;
    }

    // Read the disabled state straight from the ConnectionManager: it
    // owns retry / transient-vs-persistent classification and stamps the
    // `traceId`, so `isDisabled` is the single source of truth. The
    // `traceId` surfaced here is exactly the one written to the
    // structured boot log, letting operators correlate a support ticket
    // ("got error xxxxxx") with the originating connection failure via
    // `grep traceId=<id>`.
    const disabled = bot.connectionManager?.isDisabled(asGuildId(guildId));
    if (disabled !== undefined) {
        await replyOrEdit(
            bot,
            interaction,
            bot.translator?.t('errors:db.guild_disabled', { traceId: disabled.traceId }) ?? '',
        );
        return null;
    }

    const repos = bot.getRepos(guildId);
    if (repos === undefined) {
        await replyOrEdit(
            bot,
            interaction,
            bot.translator?.t('errors:db.not_found') ?? '',
        );
        return null;
    }
    return repos;
};
