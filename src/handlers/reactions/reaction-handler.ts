/**
 * Reaction handler contract.
 *
 * Split out of `reactions/index.ts` so it carries no dependency on the
 * generated handler registry. See `buttons/button-handler.ts` for the
 * rationale behind the split.
 */
import type { MessageReaction, User } from 'discord.js';
import type { BaseBot } from '@bot';

export abstract class ReactionHandler {
    public abstract executeAdded(reaction: MessageReaction, user: User, bot: BaseBot): Promise<void>;
    public abstract executeRemoved(reaction: MessageReaction, user: User, bot: BaseBot): Promise<void>;
}
