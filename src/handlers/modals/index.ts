import {
    ModalSubmitInteraction,
} from 'discord.js';
import { BaseBot } from "@bot";

import { HandlerFactory } from "handlers";
import { replyTranslated } from "../reply-translated";

export abstract class ModalHandler {
    public abstract execute(interaction: ModalSubmitInteraction, bot: BaseBot): Promise<void>;
}

export const registerModals = async (bot: BaseBot) => {
    logSystem(bot.logger, bot.clientId, "Registering modal handlers...");

    try {
        // todo: whether to specify handlers for each bot
        // import all modal handlers
        bot.modalHandler = createAllModalHandlers();

        logSystem(bot.logger, bot.clientId, `Successfully register ${bot.modalHandler.size} modal handlers.`)
    } catch (err) {
        logSystem(bot.logger, bot.clientId, `Failed to register modal handlers: ${err}`);
    }
}

export const executeModal = async (interaction: ModalSubmitInteraction, bot: BaseBot) => {
    if (!bot.modalHandler) {
        await replyTranslated(interaction, bot.translator, 'errors:command.handler_not_initialised');
        return;
    }

    // customId format: <modal_type>|<modal_value>
    const modal_type = interaction.customId.split('|')[0];
    const handler = bot.modalHandler.get(modal_type);
    if (handler) {
        await handler.execute(interaction, bot);
    }
}

import { MODAL_REGISTRY } from './registry.generated';

import { logSystem } from '@core/logger';
const modalHandlerFactory = new HandlerFactory<ModalHandler>();
modalHandlerFactory.registerFromRegistry(MODAL_REGISTRY);

export const getModalHandlerClass = (name: string) => modalHandlerFactory.getConstructor(name);
export const createModalHandler = (name: string) => modalHandlerFactory.create(name);
export const createAllModalHandlers = () => modalHandlerFactory.createAll();