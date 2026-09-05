/**
 * Autocomplete dispatch — the terminal stage for an
 * `ApplicationCommandAutocomplete` interaction.
 *
 * Split from `executeCommand` because the two answer to opposite
 * contracts. A slash command may reply, defer, and report a failure to
 * the member; an autocomplete interaction may do exactly one thing —
 * `respond` with a list, once, within three seconds — and has no way to
 * say that anything went wrong. So every unusable state here resolves
 * to an empty list: an unknown command, a command with no
 * {@link Command.autocomplete} hook, a hook that threw, or a `respond`
 * Discord refused.
 *
 * Only the last two are logged. The first two are configuration states
 * rather than failures — Discord asks for suggestions only on an option
 * a handler flagged, so a missing hook means the flag and the hook were
 * declared apart, which `command-autocomplete-pairing.test.ts` catches
 * before it ships. Logging them here would instead write a line per
 * keystroke for a mistake no operator can act on.
 *
 * The same asymmetry is why the hook returns suggestions rather than
 * sending them. Discord's limits live here, applied to whatever a hook
 * hands back, so no handler can produce a payload the API rejects — and
 * a rejected payload is invisible to the member, which makes it exactly
 * the kind of bug that survives for months.
 */
import type { AutocompleteInteraction } from 'discord.js';
import type { BaseBot } from '@bot';

import { logError, logSystem, ops } from '../../core/logger';
import {
  MAX_AUTOCOMPLETE_CHOICES,
  MAX_AUTOCOMPLETE_FIELD_LENGTH,
} from '../../infra/discord/autocomplete-limits';
import { isExpiredInteractionError } from '../../infra/discord/expired-interaction';

import type { CommandSuggestions } from './command';

/**
 * Cut `suggestions` down to what Discord will accept.
 *
 * Truncation is the backstop, not the design: a hook that can produce
 * an over-long value should drop the candidate itself, because half a
 * value is usually worse than no suggestion. What this guarantees is
 * only that a careless hook cannot turn into a 400 the member never
 * sees.
 */
const boundToDiscordLimits = (suggestions: CommandSuggestions): CommandSuggestions =>
  suggestions.slice(0, MAX_AUTOCOMPLETE_CHOICES).map((choice) => ({
    name: choice.name.slice(0, MAX_AUTOCOMPLETE_FIELD_LENGTH),
    value: choice.value.slice(0, MAX_AUTOCOMPLETE_FIELD_LENGTH),
  }));

/** Record a failure the member will never see, with its cause attached. */
const logFailure = (interaction: AutocompleteInteraction, bot: BaseBot, err: unknown): void => {
  logError(
    bot.logger,
    interaction.guildId,
    new Error(ops.command.autocompleteFailed(interaction.commandName), { cause: err }),
  );
};

/**
 * The hook's suggestions, already bounded — or an empty list if the
 * command has no hook or the hook threw. Never rejects; the caller
 * still has to answer Discord.
 *
 * Bounding happens inside this guard on purpose: a hook returning a
 * malformed choice fails here, where it is classified as the handler
 * defect it is, rather than downstream where it would be filed as a
 * delivery problem.
 */
const collectSuggestions = async (
  interaction: AutocompleteInteraction,
  bot: BaseBot,
): Promise<CommandSuggestions> => {
  try {
    const handler = bot.commandHandlers.get(interaction.commandName);
    const suggestions = (await handler?.autocomplete?.(interaction, bot)) ?? [];
    return boundToDiscordLimits(suggestions);
  } catch (err) {
    // The hook is the handler's own code, so a throw is a defect.
    logFailure(interaction, bot, err);
    return [];
  }
};

/**
 * Answer an autocomplete interaction with the named command's
 * suggestions, or with an empty list when there are none to give.
 *
 * Never rejects, so the middleware chain that called it still runs its
 * remaining stages.
 */
export const executeAutocomplete = async (
  interaction: AutocompleteInteraction,
  bot: BaseBot,
): Promise<void> => {
  const suggestions = await collectSuggestions(interaction, bot);
  try {
    await interaction.respond(suggestions);
  } catch (err) {
    // The two rejections are not the same event. A closed window is
    // routine under load and nobody's defect; anything else — a
    // rejected payload, a revoked token, a rate limit — is a fault that
    // would otherwise be invisible, since this surface has no way to
    // report one to the member.
    if (isExpiredInteractionError(err)) {
      logSystem(bot.logger, ops.command.autocompleteExpired(interaction.commandName, err.code));
      return;
    }
    logFailure(interaction, bot, err);
  }
};
