import type { MessageReaction, User } from 'discord.js';
import type { BaseBot } from '@bot';

import { createHandlerRegistrar, type HandlerBarrelSpec } from 'handlers';
// `./reaction-handler` is imported BEFORE `./registry.generated` so
// the abstract class is on `module.exports` by the time the generated
// registry pulls in handler subclasses. See `reaction-handler.ts`.
import { ReactionHandler } from './reaction-handler';
import { REACTION_REGISTRY } from './registry.generated';

export { ReactionHandler };

const REACTION_BARREL: HandlerBarrelSpec<ReactionHandler> = {
  registry: REACTION_REGISTRY,
  label: 'reaction',
  assign: (bot: BaseBot, handlers) => {
    bot.reactionHandlers = handlers;
  },
  read: (bot: BaseBot) => bot.reactionHandlers,
};

export const registerReactions = createHandlerRegistrar(REACTION_BARREL);

/**
 * Reactions carry no customId, so every registered handler sees every
 * reaction and decides for itself whether the emoji / message concerns
 * it. That fan-out is why this family has no custom-id dispatcher.
 */
export const executeReactionAdded = async (
  reaction: MessageReaction,
  user: User,
  bot: BaseBot,
): Promise<void> => {
  for (const handler of REACTION_BARREL.read(bot).values()) {
    await handler.executeAdded(reaction, user, bot);
  }
};

export const executeReactionRemoved = async (
  reaction: MessageReaction,
  user: User,
  bot: BaseBot,
): Promise<void> => {
  for (const handler of REACTION_BARREL.read(bot).values()) {
    await handler.executeRemoved(reaction, user, bot);
  }
};
