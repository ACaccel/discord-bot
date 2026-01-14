import { 
    ApplicationCommandDataResolvable,
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    ContextMenuCommandType,
    REST,
    Routes,
    RateLimitData,
} from "discord.js";
import { BaseBot } from "@bot";
import { logger, bot_cmd } from "@utils";
import { HandlerFactory } from "handlers";

export interface CommandConfig {
    name: string;   // command name for handler lookup and display
    description: string;
    type?: ContextMenuCommandType;   // for context menu commands, default is Chat Input
    options?: {
        string?: CommandOption[];
        number?: CommandOption[];
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

export const executeCommand = async (interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction, bot: BaseBot, blocked_channels?: string[]) => {
    if (!bot.config.commands) {
        interaction.reply({ content: "Config of commands not found.", ephemeral: true });
        return;
    }
    if (!bot.commandHandlers) {
        interaction.reply({ content: "Command handler not found.", ephemeral: true });
        return;
    }

    const handler = bot.commandHandlers.get(interaction.commandName);
    if (handler) {
        await handler.execute(interaction, bot);
    } else {
        interaction.reply({ content: "Command not found.", ephemeral: true });
    }
    
    const parentId = interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
    if (!(blocked_channels && (blocked_channels.includes(interaction.channelId) || (parentId && blocked_channels.includes(parentId))))) {
        const channel_log = `Command: /${interaction.commandName}, User: ${interaction.user.displayName}, Channel: <#${interaction.channelId}>`;
        logger.channelLogger(bot.guildInfo[interaction.guildId as string]?.channels?.debug, undefined, channel_log);
    }
    if (interaction.guild) {
        const guild_log = `Command: /${interaction.commandName}, User: ${interaction.user.displayName}, Channel: ${interaction.guild?.channels.cache.get(interaction.channelId)?.name}`;
        logger.guildLogger(bot.clientId, interaction.guild.id, 'interaction_create', guild_log, interaction.guild?.name as string);
    }
}

const commandHandlerFactory = new HandlerFactory<Command>();
const commandsDir = __dirname;
commandHandlerFactory.register(commandsDir);

export const getSlashCommandClass = (name: string) => commandHandlerFactory.getConstructor(name);
export const createCommand = (name: string) => commandHandlerFactory.create(name);
export const createAllSlashCommands = () => commandHandlerFactory.createAll();