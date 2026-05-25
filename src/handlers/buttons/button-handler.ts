/**
 * Button handler contract.
 *
 * Split out of `buttons/index.ts` so it carries no dependency on the
 * generated handler registry. Handler subclasses can import
 * `ButtonHandler` through the `@button` barrel without triggering the
 * circular-import trap that occurs when the barrel's
 * `./registry.generated` import is evaluated before the class
 * declaration during module initialisation.
 */
import type { ButtonInteraction } from 'discord.js';
import type { BaseBot } from '@bot';

export abstract class ButtonHandler {
    public abstract execute(interaction: ButtonInteraction, bot: BaseBot): Promise<void>;
}
