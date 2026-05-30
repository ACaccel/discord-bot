import type {
    ModalSubmitInteraction,
} from 'discord.js';
import type { BaseBot } from "@bot";
import { logSystem } from '@core/logger';

import { HandlerFactory } from "handlers";
import { replyTranslated } from "../reply-translated";
// `./modal-handler` is imported BEFORE `./registry.generated` so the
// abstract class is on `module.exports` by the time the generated
// registry pulls in handler subclasses. See `modal-handler.ts`.
import { ModalHandler } from './modal-handler';
import { MODAL_REGISTRY } from './registry.generated';

export { ModalHandler };

export const registerModals = async (bot: BaseBot) => {
    logSystem(bot.logger, "Registering modal handlers...");

    try {
        // todo: whether to specify handlers for each bot
        // import all modal handlers
        bot.modalHandlers = createAllModalHandlers();

        logSystem(bot.logger, `Successfully register ${bot.modalHandlers.size} modal handlers.`)
    } catch (err) {
        logSystem(bot.logger, `Failed to register modal handlers: ${err}`);
    }
}

export const executeModal = async (interaction: ModalSubmitInteraction, bot: BaseBot) => {
    if (!bot.modalHandlers) {
        await replyTranslated(interaction, bot.translator, 'errors:command.handler_not_initialised');
        return;
    }

    // customId format: <modal_type>|<modal_value>
    const modal_type = interaction.customId.split('|')[0] ?? '';
    const handler = bot.modalHandlers.get(modal_type);
    if (handler) {
        await handler.execute(interaction, bot);
    }
}

const modalHandlerFactory = new HandlerFactory<ModalHandler>();
modalHandlerFactory.registerFromRegistry(MODAL_REGISTRY);

export const getModalHandlerClass = (name: string) => modalHandlerFactory.getConstructor(name);
export const createModalHandler = (name: string) => modalHandlerFactory.create(name);
export const createAllModalHandlers = () => modalHandlerFactory.createAll();