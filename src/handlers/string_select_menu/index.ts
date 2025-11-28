import { 
    StringSelectMenuInteraction,
} from "discord.js";
import { BaseBot } from "@bot";
import { logger } from "@utils";
import { HandlerFactory } from "handlers";

//==================================================//
// String Select Menu Custom ID: <ssm_type|ssm_value>
//==================================================// 

export abstract class SSMHandler {
    public abstract execute(interaction: StringSelectMenuInteraction, bot: BaseBot): Promise<void>;
}

export const registerSSMs = async (bot: BaseBot) => {
    logger.systemLogger(bot.clientId, "Registering string select menu handlers...");

    try {
        // todo: whether to specify handlers for each bot
        // import all string select menu handlers
        bot.ssmHandler = createAllSSMHandlers();

        logger.systemLogger(bot.clientId, `Successfully register ${bot.ssmHandler.size} string select menu handlers.`)
    } catch (err) {
        logger.systemLogger(bot.clientId, `Failed to register string select menu handlers: ${err}`);
    }
}

export const executeSSM = async (interaction: StringSelectMenuInteraction, bot: BaseBot) => {
    if (!bot.ssmHandler) {
        interaction.reply({ content: "String select menu handler not found.", ephemeral: true });
        return;
    }

    // customId format: <ssm_type>|<ssm_value>
    const ssm_type = interaction.customId.split('|')[0];
    const handler = bot.ssmHandler.get(ssm_type);
    if (handler) {
        await handler.execute(interaction, bot);
    }
}

const ssmHandlerFactory = new HandlerFactory<SSMHandler>();
const ssmDir = __dirname;
ssmHandlerFactory.register(ssmDir);

export const getSSMHandlerClass = (name: string) => ssmHandlerFactory.getConstructor(name);
export const createSSMHandler = (name: string) => ssmHandlerFactory.create(name);
export const createAllSSMHandlers = () => ssmHandlerFactory.createAll();