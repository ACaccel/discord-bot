import type { 
    MessageReaction,
    User,
} from "discord.js";
import type { BaseBot } from "@bot";

import { HandlerFactory } from "handlers";

export abstract class ReactionHandler {
    public abstract executeAdded(reaction: MessageReaction, user: User, bot: BaseBot): Promise<void>;
    public abstract executeRemoved(reaction: MessageReaction, user: User, bot: BaseBot): Promise<void>;
}

export const registerReactions = async (bot: BaseBot) => {
    logSystem(bot.logger, bot.clientId, "Registering reaction handlers...");
    try {
        // todo: whether to specify handlers for each bot
        // import all reaction handlers
        bot.reactionHandlers = createAllReactionHandlers();

        logSystem(bot.logger, bot.clientId, `Successfully register ${bot.reactionHandlers.size} reaction handlers.`);
    } catch (err) {
        logSystem(bot.logger, bot.clientId, `Failed to register reaction handlers: ${err}`);
    }
}

export const executeReactionAdded = async (reaction: MessageReaction, user: User, bot: BaseBot) => {
    if (!bot.reactionHandlers) {
        logSystem(bot.logger, bot.clientId, "Reaction handler not found.");
        return;
    }

    // Execute all registered reaction handlers
    for (const handler of bot.reactionHandlers.values()) {
        await handler.executeAdded(reaction, user, bot);
    }
};

export const executeReactionRemoved = async (reaction: MessageReaction, user: User, bot: BaseBot) => {
    if (!bot.reactionHandlers) {
        logSystem(bot.logger, bot.clientId, "Reaction handler not found.");
        return;
    }

    // Execute all registered reaction handlers
    for (const handler of bot.reactionHandlers.values()) {
        await handler.executeRemoved(reaction, user, bot);
    }
};

import { REACTION_REGISTRY } from './registry.generated';

import { logSystem } from '@core/logger';
const reactionHandlerFactory = new HandlerFactory<ReactionHandler>();
reactionHandlerFactory.registerFromRegistry(REACTION_REGISTRY);

export const getReactionHandlerClass = (name: string) => reactionHandlerFactory.getConstructor(name);
export const createReactionHandler = (name: string) => reactionHandlerFactory.create(name);
export const createAllReactionHandlers = () => reactionHandlerFactory.createAll();