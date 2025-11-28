import { 
    ModalSubmitInteraction,
} from "discord.js";
import { BaseBot } from "@bot";
import { logger } from "@utils";
import { HandlerFactory } from "handlers";

export abstract class ModalHandler {
    public abstract execute(interaction: ModalSubmitInteraction, bot: BaseBot): Promise<void>;
}

export const registerModals = async (bot: BaseBot) => {
    logger.systemLogger(bot.clientId, "Registering modal handlers...");

    try {
        // todo: whether to specify handlers for each bot
        // import all modal handlers
        bot.modalHandler = createAllModalHandlers();

        logger.systemLogger(bot.clientId, `Successfully register ${bot.modalHandler.size} modal handlers.`)
    } catch (err) {
        logger.systemLogger(bot.clientId, `Failed to register modal handlers: ${err}`);
    }
}

export const executeModal = async (interaction: ModalSubmitInteraction, bot: BaseBot) => {
    if (!bot.modalHandler) {
        interaction.reply({ content: "Modal handler not found.", ephemeral: true });
        return;
    }

    // customId format: <modal_type>|<modal_value>
    const modal_type = interaction.customId.split('|')[0];
    const handler = bot.modalHandler.get(modal_type);
    if (handler) {
        await handler.execute(interaction, bot);
    }
}

const modalHandlerFactory = new HandlerFactory<ModalHandler>();
const modalDir = __dirname;
modalHandlerFactory.register(modalDir);

export const getModalHandlerClass = (name: string) => modalHandlerFactory.getConstructor(name);
export const createModalHandler = (name: string) => modalHandlerFactory.create(name);
export const createAllModalHandlers = () => modalHandlerFactory.createAll();