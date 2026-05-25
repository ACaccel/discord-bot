import type {
    ButtonInteraction,
} from 'discord.js';
import type { BaseBot } from "@bot";
import { logSystem } from '@core/logger';

import { HandlerFactory } from "handlers";
import { replyTranslated } from "../reply-translated";
// `./button-handler` is imported BEFORE `./registry.generated` so the
// abstract class is on `module.exports` by the time the generated
// registry pulls in handler subclasses (which import the class back
// through this barrel). See `button-handler.ts`.
import { ButtonHandler } from './button-handler';
import { BUTTON_REGISTRY } from './registry.generated';

export { ButtonHandler };

//==================================================//
// Button Custom ID: <button_type>|<button_value>
//==================================================//

export const registerButtons = async (bot: BaseBot) => {
    logSystem(bot.logger, bot.clientId, "Registering button handlers...");

    try {
        // todo: whether to specify handlers for each bot
        // import all button handlers
        bot.buttonHandlers = createAllButtonHandlers();

        logSystem(bot.logger, bot.clientId, `Successfully register ${bot.buttonHandlers.size} button handlers.`)
    } catch (err) {
        logSystem(bot.logger, bot.clientId, `Failed to register button handlers: ${err}`);
    }
}

export const executeButton = async (interaction: ButtonInteraction, bot: BaseBot) => {
    if (!bot.buttonHandlers) {
        await replyTranslated(interaction, bot.translator, 'errors:command.handler_not_initialised');
        return;
    }

    // customId format: <button_type>|<button_value>
    const button_type = interaction.customId.split('|')[0] ?? '';
    const handler = bot.buttonHandlers.get(button_type);
    if (handler) {
        await handler.execute(interaction, bot);
    }
}

const buttonHandlerFactory = new HandlerFactory<ButtonHandler>();
buttonHandlerFactory.registerFromRegistry(BUTTON_REGISTRY);

export const getButtonHandlerClass = (name: string) => buttonHandlerFactory.getConstructor(name);
export const createButtonHandler = (name: string) => buttonHandlerFactory.create(name);
export const createAllButtonHandlers = () => buttonHandlerFactory.createAll();