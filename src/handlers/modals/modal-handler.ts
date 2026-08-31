/**
 * Modal handler contract.
 *
 * Split out of `modals/index.ts` so it carries no dependency on the
 * generated handler registry. See `buttons/button-handler.ts` for the
 * rationale behind the split.
 */
import type { ModalSubmitInteraction } from 'discord.js';
import type { BaseBot } from '@bot';

export abstract class ModalHandler {
  public abstract execute(interaction: ModalSubmitInteraction, bot: BaseBot): Promise<void>;
}
