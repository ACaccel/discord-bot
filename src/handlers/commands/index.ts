import { 
    ChatInputCommandInteraction,
    RESTPostAPIChatInputApplicationCommandsJSONBody
} from "discord.js";
import { BaseBot } from "@bot";
import { logger, bot_cmd } from "@utils";
import { HandlerFactory } from "handlers";

export interface Command {
    name: string;
    description: string;
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

export abstract class SlashCommand {
    public config: Command | null;

    public constructor() {
        this.config = null;
    }

    public setConfig(config: Command): void {
        this.config = config;
    }

    public abstract execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void>;
}

export const getSlashCommandJsonBody = (slashCommandHandlers: Map<string, SlashCommand>, bot: BaseBot) => {
    const rest_commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = Array.from(slashCommandHandlers.values())
        .filter((cmd: SlashCommand) => {
            if (!cmd.config) {
                logger.errorLogger(bot.clientId, null, `Command ${cmd} has no config.`);
                return false;
            }
            return true;
        })
        .map((cmd: SlashCommand) => bot_cmd.buildSlashCommandJsonBody(cmd.config!));
    return rest_commands;
}

export const registerSlashCommands = async (bot: BaseBot) => {
    logger.systemLogger(bot.clientId, "Registering commands...");

    try {
        if (!bot.config.commands) {
            logger.systemLogger(bot.clientId, "No commands to register.");
            return;
        }

        // build slash commands from config
        bot.config.commands.forEach((name) => {
            const newSlashCommand = createSlashCommand(name);
            if (newSlashCommand) {
                bot.slashCommandHandlers.set(name, newSlashCommand);
            }
        });

        // register slash commands to Discord API
        await bot.client.application?.commands.set([]);
        const rest_commands = getSlashCommandJsonBody(bot.slashCommandHandlers, bot);
        await Promise.all(
            Object.entries(bot.guildInfo).map(async ([guildId]) => {
                await bot.client.application?.commands.set(rest_commands, guildId);
            })
        );

        logger.systemLogger(bot.clientId, `Successfully register ${bot.slashCommandHandlers.size} application (/) commands.`)
    } catch (err) {
        logger.systemLogger(bot.clientId, `Failed to register commands: ${err}`);
    }
}

export const executeSlashCommand = async (interaction: ChatInputCommandInteraction, bot: BaseBot, blocked_channels?: string[]) => {
    if (!bot.config.commands) {
        interaction.reply({ content: "Config of commands not found.", ephemeral: true });
        return;
    }
    if (!bot.slashCommandHandlers) {
        interaction.reply({ content: "Command handler not found.", ephemeral: true });
        return;
    }

    const command = bot.config.commands.find((cmd) => cmd === interaction.commandName);
    if (command) {
        const handler = bot.slashCommandHandlers.get(interaction.commandName)
        if (handler) {
            await handler.execute(interaction, bot);
        }
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

// const buttonHandlerFactory = new HandlerFactory<ButtonHandler>();
// const buttonDir = __dirname;
// buttonHandlerFactory.register(buttonDir);

// export const getButtonHandlerClass = (name: string) => buttonHandlerFactory.getConstructor(name);
// export const createButtonHandler = (name: string) => buttonHandlerFactory.create(name);
// export const createAllButtonHandlers = () => buttonHandlerFactory.createAll();
const commandHandlerFactory = new HandlerFactory<SlashCommand>();
const commandsDir = __dirname;
commandHandlerFactory.register(commandsDir);

export const getSlashCommandClass = (name: string) => commandHandlerFactory.getConstructor(name);
export const createSlashCommand = (name: string) => commandHandlerFactory.create(name);
export const createAllSlashCommands = () => commandHandlerFactory.createAll();