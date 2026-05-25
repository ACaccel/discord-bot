/**
 * String select menu handler contract.
 *
 * Split out of `select-menus/index.ts` so it carries no dependency on
 * the generated handler registry. See `buttons/button-handler.ts` for
 * the rationale behind the split.
 */
import type { StringSelectMenuInteraction } from 'discord.js';
import type { BaseBot } from '@bot';

export abstract class SSMHandler {
    public abstract execute(interaction: StringSelectMenuInteraction, bot: BaseBot): Promise<void>;
}
