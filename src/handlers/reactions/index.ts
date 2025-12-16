import { 
    MessageReaction,
    User,
} from "discord.js";
import { BaseBot } from "@bot";
import { logger } from "@utils";
import { HandlerFactory } from "handlers";

export abstract class ReactionHandler {
    public abstract executeAdded(reaction: MessageReaction, user: User, bot: BaseBot): Promise<void>;
    public abstract executeRemoved(reaction: MessageReaction, user: User, bot: BaseBot): Promise<void>;
}

export const registerReactions = async (bot: BaseBot) => {
    logger.systemLogger(bot.clientId, "Registering reaction handlers...");
    try {
        // todo: whether to specify handlers for each bot
        // import all reaction handlers
        bot.reactionHandler = createAllReactionHandlers();

        logger.systemLogger(bot.clientId, `Successfully register ${bot.reactionHandler.size} reaction handlers.`);
    } catch (err) {
        logger.systemLogger(bot.clientId, `Failed to register reaction handlers: ${err}`);
    }
}

export const executeReactionAdded = async (reaction: MessageReaction, user: User, bot: BaseBot) => {
    if (!bot.reactionHandler) {
        logger.systemLogger(bot.clientId, "Reaction handler not found.");
        return;
    }

    // Execute all registered reaction handlers
    for (const handler of bot.reactionHandler.values()) {
        await handler.executeAdded(reaction, user, bot);
    }
};

export const executeReactionRemoved = async (reaction: MessageReaction, user: User, bot: BaseBot) => {
    if (!bot.reactionHandler) {
        logger.systemLogger(bot.clientId, "Reaction handler not found.");
        return;
    }

    // Execute all registered reaction handlers
    for (const handler of bot.reactionHandler.values()) {
        await handler.executeRemoved(reaction, user, bot);
    }
};

const reactionHandlerFactory = new HandlerFactory<ReactionHandler>();
const reactionDir = __dirname;
reactionHandlerFactory.register(reactionDir);

export const getReactionHandlerClass = (name: string) => reactionHandlerFactory.getConstructor(name);
export const createReactionHandler = (name: string) => reactionHandlerFactory.create(name);
export const createAllReactionHandlers = () => reactionHandlerFactory.createAll();