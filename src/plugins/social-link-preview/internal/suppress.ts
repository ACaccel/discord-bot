/**
 * Apply the configured strategy to the user's original message after a
 * preview has been posted.
 *
 * Suppressing or deleting another user's message requires the bot to
 * hold `ManageMessages` in the channel. The permission is checked first;
 * when it is missing the original is left intact and the fact is logged
 * at debug level — the preview reply has already been posted, so the
 * feature degrades to reply-only rather than failing. Every Discord call
 * is wrapped so a permission/race failure can never throw out of the
 * event handler.
 *
 * Note on timing: Discord generates the auto-embed asynchronously, often
 * after `messageCreate` fires, but setting the SUPPRESS_EMBEDS flag also
 * hides embeds that load afterward — so suppressing immediately is
 * correct and we need not wait for a later `messageUpdate`.
 */
import { PermissionFlagsBits, type Message } from 'discord.js';

import { logError, type Logger } from '../../../core/logger';

export type OriginalMessageStrategy = 'suppress' | 'delete' | 'leave';

/** Centralised operator-facing log message (no scattered literals). */
const LOG_MISSING_PERMISSION =
  'social-link-preview: missing ManageMessages; left original message intact';

export const applyOriginalMessageStrategy = async (
  message: Message,
  strategy: OriginalMessageStrategy,
  logger: Logger,
): Promise<void> => {
  if (strategy === 'leave') return;

  try {
    // Permissions are only resolvable for a guild message; `inGuild`
    // narrows the channel to one exposing `permissionsFor`.
    if (!message.inGuild()) return;
    const botUser = message.client.user;
    if (botUser === null) return;

    const permissions = message.channel.permissionsFor(botUser);
    if (permissions === null || !permissions.has(PermissionFlagsBits.ManageMessages)) {
      logger.debug({ strategy, channelId: message.channelId }, LOG_MISSING_PERMISSION);
      return;
    }

    if (strategy === 'suppress') {
      await message.suppressEmbeds(true);
    } else {
      await message.delete();
    }
  } catch (err: unknown) {
    // A race (message already deleted) or transient API failure must not
    // surface — the preview is already posted.
    logError(logger, message.guildId, err);
  }
};
