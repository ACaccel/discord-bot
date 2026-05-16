/**
 * Default interaction middlewares for {@link InteractionRouter}.
 *
 * Audit B-2 wires the router as BaseBot's primary dispatch path. The
 * functions here factor the previously-inline "switch by interaction
 * type" logic and the channel-logging behaviour into the
 * Chain-of-Responsibility pattern the plan envisaged.
 *
 * Two middlewares ship today:
 *   - {@link createDispatchMiddleware} — terminal stage. Routes the
 *     interaction to the right `execute*` dispatcher based on its
 *     discriminant, mirroring what `BaseBot.interactionEventListener`
 *     used to do inline. Calls `next()` after dispatch so logging
 *     middleware runs.
 *   - {@link createChannelLoggingMiddleware} — slash-command logging
 *     sink. Honours an optional `blockedChannels` list so a guild's
 *     noisy channels stay out of the debug feed. Was previously
 *     inlined inside `executeCommand`; lifting it into a middleware
 *     means a bot that wants different logging policy declares one
 *     instead of overriding `executeCommand`.
 */
import { MessageFlags } from 'discord.js';
import type { BaseBot } from './index';
import { executeCommand } from '@cmd';
import { executeButton } from '@button';
import { executeModal } from '@modal';
import { executeSSM } from '@select-menu';
import { logger } from '@utils';
import type { InteractionContext, InteractionMiddleware } from '../core/plugin';
import { replyTranslated } from '../handlers/reply-translated';

/**
 * Routes the inbound interaction to the matching dispatcher. Calls
 * `next()` after dispatch so observability middleware (channel logger,
 * future tracing hooks) still runs even when the dispatcher returned a
 * user-facing reply.
 */
export const createDispatchMiddleware = (bot: BaseBot): InteractionMiddleware => ({
    name: 'dispatch',
    async run(ctx: InteractionContext, next): Promise<void> {
        const interaction = ctx.interaction;
        if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
            await executeCommand(interaction, bot);
        } else if (interaction.isModalSubmit()) {
            await executeModal(interaction, bot);
        } else if (interaction.isButton()) {
            await executeButton(interaction, bot);
        } else if (interaction.isStringSelectMenu()) {
            await executeSSM(interaction, bot);
        } else if (!interaction.isAutocomplete() && interaction.isRepliable()) {
            await interaction.reply({
                content: bot.translator?.t('errors:command.unsupported_interaction_type') ?? '',
                flags: MessageFlags.Ephemeral,
            });
        }
        await next();
    },
});

export interface ChannelLoggingMiddlewareConfig {
    /** Channels (and parent thread channels) whose commands stay out of the debug feed. */
    readonly blockedChannels?: readonly string[];
}

/**
 * Emits the per-command channel log line + guild log line. Only fires
 * for slash-command / context-menu interactions because the legacy
 * implementation only logged those. `blockedChannels` (including parent
 * thread channels) suppresses the debug-channel line but never the
 * guild log — the latter is a permanent audit trail.
 */
export const createChannelLoggingMiddleware = (
    bot: BaseBot,
    config: ChannelLoggingMiddlewareConfig = {},
): InteractionMiddleware => ({
    name: 'channel-logging',
    async run(ctx: InteractionContext, next): Promise<void> {
        // try/finally so the durable guild audit-trail entry STILL
        // lands even if dispatch threw — reviewer-flagged BLOCK on a
        // previous draft. Re-throw any caught error so the outer
        // handler still surfaces it to the user.
        try {
            await next();
        } finally {
            const interaction = ctx.interaction;
            if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
                const blocked = config.blockedChannels;
                const parentId =
                    interaction.channel && 'parentId' in interaction.channel
                        ? interaction.channel.parentId
                        : null;
                const isBlocked =
                    blocked !== undefined &&
                    (blocked.includes(interaction.channelId) ||
                        (parentId !== null && blocked.includes(parentId)));
                if (!isBlocked && interaction.guildId !== null) {
                    const channel_log = `Command: /${interaction.commandName}, User: ${interaction.user.displayName}, Channel: <#${interaction.channelId}>`;
                    logger.channelLogger(
                        bot.guildInfo[interaction.guildId]?.channels?.debug,
                        undefined,
                        channel_log,
                    );
                }
                if (interaction.guild) {
                    const guild_log = `Command: /${interaction.commandName}, User: ${interaction.user.displayName}, Channel: ${interaction.guild?.channels.cache.get(interaction.channelId)?.name}`;
                    logger.guildLogger(
                        bot.clientId,
                        interaction.guild.id,
                        'interaction_create',
                        guild_log,
                        interaction.guild?.name as string,
                    );
                }
            }
        }
    },
});

// Re-export so consumers needing the helper to construct a fallback
// reply have one canonical path.
export { replyTranslated };
