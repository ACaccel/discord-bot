import type {
    StringSelectMenuInteraction,
} from 'discord.js';
import type { BaseBot } from "@bot";
import { logSystem } from '@core/logger';

import { HandlerFactory } from "handlers";
import { replyTranslated } from "../reply-translated";
// `./ssm-handler` is imported BEFORE `./registry.generated` so the
// abstract class is on `module.exports` by the time the generated
// registry pulls in handler subclasses. See `ssm-handler.ts`.
import { SSMHandler } from './ssm-handler';
import { SSM_REGISTRY } from './registry.generated';

export { SSMHandler };

//==================================================//
// String Select Menu Custom ID: <ssm_type|ssm_value>
//==================================================//

export const registerSSMs = async (bot: BaseBot) => {
    logSystem(bot.logger, "Registering string select menu handlers...");

    try {
        // todo: whether to specify handlers for each bot
        // import all string select menu handlers
        bot.ssmHandlers = createAllSSMHandlers();

        logSystem(bot.logger, `Successfully register ${bot.ssmHandlers.size} string select menu handlers.`)
    } catch (err) {
        logSystem(bot.logger, `Failed to register string select menu handlers: ${err}`);
    }
}

export const executeSSM = async (interaction: StringSelectMenuInteraction, bot: BaseBot) => {
    if (!bot.ssmHandlers) {
        await replyTranslated(interaction, bot.translator, 'errors:command.handler_not_initialised');
        return;
    }

    // customId format: <ssm_type>|<ssm_value>
    const ssm_type = interaction.customId.split('|')[0] ?? '';
    const handler = bot.ssmHandlers.get(ssm_type);
    if (handler) {
        await handler.execute(interaction, bot);
    }
}

const ssmHandlerFactory = new HandlerFactory<SSMHandler>();
ssmHandlerFactory.registerFromRegistry(SSM_REGISTRY);

export const getSSMHandlerClass = (name: string) => ssmHandlerFactory.getConstructor(name);
export const createSSMHandler = (name: string) => ssmHandlerFactory.create(name);
export const createAllSSMHandlers = () => ssmHandlerFactory.createAll();