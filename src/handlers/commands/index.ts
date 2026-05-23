import type {
    ApplicationCommandDataResolvable,
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
} from 'discord.js';
import type { BaseBot } from "@bot";
import { logError, logSystem, ops } from "../../core/logger";
import { HandlerFactory } from "handlers";
import { replyTranslated } from "../reply-translated";
import { Command, localizeCommandConfig } from './command';
import { buildCommandJsonBody } from './command-builder';
import { COMMAND_REGISTRY } from './registry.generated';

// Command metadata contract + i18n resolution live in `./command` so
// this barrel (which pulls in the generated handler registry) is not a
// dependency of every handler module.
export {
    Command,
    localizeCommandConfig,
    type CommandConfig,
    type CommandOption,
    type CommandChoice,
    type LocalizedCommandConfig,
    type LocalizedCommandOption,
    type LocalizedCommandChoice,
} from './command';
export { buildCommandJsonBody } from './command-builder';

export const getCommandJsonBody = (commandHandlers: Map<string, Command>, bot: BaseBot) => {
    const rest_commands: ApplicationCommandDataResolvable[] = Array.from(commandHandlers.values())
        .filter((cmd: Command) => {
            if (!cmd.config) {
                logError(bot.logger, bot.clientId, null, ops.command.handlerMissingConfig(String(cmd)));
                return false;
            }
            return true;
        })
        .map((cmd: Command) =>
            buildCommandJsonBody(localizeCommandConfig(cmd.config, bot.translator)),
        );
    return rest_commands;
}

export const registerCommands = async (bot: BaseBot) => {
    logSystem(bot.logger, bot.clientId, ops.command.registerStart());

    try {
        if (!bot.config.commands) {
            logSystem(bot.logger, bot.clientId, ops.command.registerEmpty());
            return;
        }

        // build commands from config
        bot.config.commands.forEach((name) => {
            const newCommand = createCommand(name);
            if (newCommand) {
                // Key by the *localised* command name so the map key
                // matches the name Discord registers and echoes back as
                // `interaction.commandName`. For chat-input commands the
                // localised name equals `config.name` (a lowercase-ASCII
                // id); for context-menu commands it is the catalog
                // display name.
                const registeredName = localizeCommandConfig(
                    newCommand.config,
                    bot.translator,
                ).name;
                bot.commandHandlers.set(registeredName, newCommand);
            }
        });
        
        logSystem(bot.logger, bot.clientId, ops.command.registerSuccess(bot.commandHandlers.size));
    } catch (err) {
        logSystem(bot.logger, bot.clientId, ops.command.registerFailed(String(err)));
    }
}

/**
 * Dispatch a slash-command / context-menu interaction to its handler.
 *
 * This function is purely concerned with handler lookup. Channel and
 * guild logging policy lives in `createChannelLoggingMiddleware` at the
 * composition root, keeping the dispatcher free of policy concerns.
 */
export const executeCommand = async (interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction, bot: BaseBot) => {
    if (!bot.config.commands) {
        await replyTranslated(interaction, bot.translator, 'errors:command.config_missing');
        return;
    }
    if (!bot.commandHandlers) {
        await replyTranslated(interaction, bot.translator, 'errors:command.handler_not_initialised');
        return;
    }

    const handler = bot.commandHandlers.get(interaction.commandName);
    if (handler) {
        await handler.execute(interaction, bot);
    } else {
        await replyTranslated(interaction, bot.translator, 'errors:command.not_found', { name: interaction.commandName });
    }
}

const commandHandlerFactory = new HandlerFactory<Command>();
commandHandlerFactory.registerFromRegistry(COMMAND_REGISTRY);

export const getSlashCommandClass = (name: string) => commandHandlerFactory.getConstructor(name);
export const createCommand = (name: string) => commandHandlerFactory.create(name);
export const createAllSlashCommands = () => commandHandlerFactory.createAll();