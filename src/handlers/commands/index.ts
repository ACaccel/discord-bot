import {
    ApplicationCommandDataResolvable,
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    ContextMenuCommandType,
    REST,
    Routes,
    RateLimitData,
} from 'discord.js';
import { BaseBot } from "@bot";
import { logger, bot_cmd } from "@utils";
import { HandlerFactory } from "handlers";
import { replyTranslated } from "../reply-translated";

export interface CommandConfig {
    name: string;   // command name for handler lookup and display
    description: string;
    type?: ContextMenuCommandType;   // for context menu commands, default is Chat Input
    options?: {
        string?: CommandOption[];
        number?: CommandOption[];
        float?: CommandOption[];
        user?: CommandOption[];
        channel?: CommandOption[];
        attachment?: CommandOption[];
    };
}

interface CommandOption {
    name: string;
    description: string;
    required: boolean;
    choices?: CommandChoice[];
    /** Minimum numeric value (only applies to `number` and `float` options). */
    min?: number;
    /** Maximum numeric value (only applies to `number` and `float` options). */
    max?: number;
}

interface CommandChoice {
    name: string;
    value: string;
}

export abstract class Command {
    public config: CommandConfig;

    public constructor() {
        this.config = { name: "", description: "" };
    }

    public setConfig(config: CommandConfig): void {
        this.config = config;
    }

    public abstract execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction, bot: BaseBot): Promise<void>;
}

export const getCommandJsonBody = (commandHandlers: Map<string, Command>, bot: BaseBot) => {
    const rest_commands: ApplicationCommandDataResolvable[] = Array.from(commandHandlers.values())
        .filter((cmd: Command) => {
            if (!cmd.config) {
                logger.errorLogger(bot.clientId, null, `Command ${cmd} has no config.`);
                return false;
            }
            return true;
        })
        .map((cmd: Command) => bot_cmd.buildCommandJsonBody(cmd.config));
    return rest_commands;
}

export const registerCommands = async (bot: BaseBot) => {
    logger.systemLogger(bot.clientId, "Registering commands...");

    // const rest = new REST({ version: "10" }).setToken(bot.getToken());
    // rest.on('rateLimited', (info: RateLimitData) => {
    //     console.log(info);
    // });
    // rest.on('restDebug', (message: string) => {
    //     console.log(message);
    // });

    try {
        if (!bot.config.commands) {
            logger.systemLogger(bot.clientId, "No commands to register.");
            return;
        }

        // build commands from config
        bot.config.commands.forEach((name) => {
            const newCommand = createCommand(name);
            if (newCommand) {
                bot.commandHandlers.set(newCommand.config.name, newCommand);    // use config name rather than class name as the key
            }
        });
        
        // deprecated: use deploy.ts instead
        // register commands to Discord API via REST (guild registration is instant)
        // const rest_commands = getCommandJsonBody(bot.commandHandlers, bot);
        // for (const [guildId] of Object.entries(bot.guildInfo)) {
        //     await rest.put(
        //         Routes.applicationGuildCommands(bot.clientId, guildId),
        //         { body: rest_commands },
        //     ).then(() => {
        //         logger.systemLogger(bot.clientId, `Registered ${rest_commands.length} commands for guild ${guildId}`);
        //     }).catch((err) => {
        //         console.error(err);
        //         logger.errorLogger(bot.clientId, guildId, `Failed to register commands for guild ${guildId}: ${err}`);
        //     });
        //     await new Promise(resolve => setTimeout(resolve, 60000)); // to avoid rate limit
        // }

        logger.systemLogger(bot.clientId, `Successfully register ${bot.commandHandlers.size} application (/) commands.`)
    } catch (err) {
        logger.systemLogger(bot.clientId, `Failed to register commands: ${err}`);
    }
}

/**
 * Dispatch a slash-command / context-menu interaction to its handler.
 *
 * Channel + guild logging used to live here (with a `blocked_channels`
 * 3rd arg threaded in from `nijika`); audit B-2 lifted that into
 * `createChannelLoggingMiddleware` so policy lives at the composition
 * root rather than buried in this dispatcher. The function is now
 * purely concerned with handler lookup.
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

import { COMMAND_REGISTRY } from './registry.generated';

const commandHandlerFactory = new HandlerFactory<Command>();
commandHandlerFactory.registerFromRegistry(COMMAND_REGISTRY);

export const getSlashCommandClass = (name: string) => commandHandlerFactory.getConstructor(name);
export const createCommand = (name: string) => commandHandlerFactory.create(name);
export const createAllSlashCommands = () => commandHandlerFactory.createAll();