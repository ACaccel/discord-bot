import {
    ButtonInteraction,
} from 'discord.js';
import { BaseBot } from "@bot";
import { logger } from "@utils";
import { HandlerFactory } from "handlers";
import { replyTranslated } from "../reply-translated";

//==================================================//
// Button Custom ID: <button_type>|<button_value>
//==================================================// 

export abstract class ButtonHandler {
    public abstract execute(interaction: ButtonInteraction, bot: BaseBot): Promise<void>;
}

export const registerButtons = async (bot: BaseBot) => {
    logger.systemLogger(bot.clientId, "Registering button handlers...");

    try {
        // todo: whether to specify handlers for each bot
        // import all button handlers
        bot.buttonHandler = createAllButtonHandlers();

        logger.systemLogger(bot.clientId, `Successfully register ${bot.buttonHandler.size} button handlers.`)
    } catch (err) {
        logger.systemLogger(bot.clientId, `Failed to register button handlers: ${err}`);
    }
}

export const executeButton = async (interaction: ButtonInteraction, bot: BaseBot) => {
    if (!bot.buttonHandler) {
        await replyTranslated(interaction, bot.translator, 'errors:command.handler_not_initialised');
        return;
    }

    // customId format: <button_type>|<button_value>
    const button_type = interaction.customId.split('|')[0];
    const handler = bot.buttonHandler.get(button_type);
    if (handler) {
        await handler.execute(interaction, bot);
    }
}

import { BUTTON_REGISTRY } from './registry.generated';

const buttonHandlerFactory = new HandlerFactory<ButtonHandler>();
buttonHandlerFactory.registerFromRegistry(BUTTON_REGISTRY);

export const getButtonHandlerClass = (name: string) => buttonHandlerFactory.getConstructor(name);
export const createButtonHandler = (name: string) => buttonHandlerFactory.create(name);
export const createAllButtonHandlers = () => buttonHandlerFactory.createAll();