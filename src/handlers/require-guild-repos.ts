import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    ModalSubmitInteraction,
    StringSelectMenuInteraction,
} from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { BaseBot } from '@bot';
import type { Repos } from '../persistence/repositories';

/**
 * Interactions that can both be replied/edited to.
 *
 * Audit 3.8: this helper subsumes the 4-line null-check-then-reply
 * boilerplate that was duplicated across 11+ handlers, and folds in
 * the audit 3.7 disabled-guild distinction so operators see a useful
 * message instead of a generic `errors:db.not_found`.
 */
type RepliableHandlerInteraction =
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction
    | ContextMenuCommandInteraction;

const replyOrEdit = async (
    interaction: RepliableHandlerInteraction,
    content: string,
): Promise<void> => {
    if (content.length === 0) return;
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
        return;
    }
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
};

/**
 * Short, non-cryptographic trace id used to correlate a user-facing
 * `errors:db.guild_disabled` message with the boot-time log line
 * recorded by `BaseBot.connectGuildDB`. 6 base-36 chars is enough to
 * make the id grep-able without bloating the user message.
 */
const makeTraceId = (): string => Math.random().toString(36).slice(2, 8);

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
 * The helper is the only place that knows about
 * {@link BaseBot.disabledGuilds}; handlers stay ignorant of the
 * transient/persistent split and only see the resolved `Repos` (or
 * an already-sent reply).
 */
export const requireGuildRepos = async (
    bot: BaseBot,
    interaction: RepliableHandlerInteraction,
): Promise<Repos | null> => {
    const guildId = interaction.guild?.id;
    if (guildId === undefined) {
        await replyOrEdit(
            interaction,
            bot.translator?.t('errors:command.guild_only') ?? '',
        );
        return null;
    }

    const disabledError = bot.disabledGuilds.get(guildId);
    if (disabledError !== undefined) {
        const traceId = makeTraceId();
        await replyOrEdit(
            interaction,
            bot.translator?.t('errors:db.guild_disabled', { traceId }) ?? '',
        );
        return null;
    }

    const repos = bot.guildInfo[guildId]?.repos;
    if (repos === undefined) {
        await replyOrEdit(
            interaction,
            bot.translator?.t('errors:db.not_found') ?? '',
        );
        return null;
    }
    return repos;
};
