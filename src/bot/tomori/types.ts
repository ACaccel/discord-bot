import { 
    Client,
    REST,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    Routes,
    Guild,
    Channel,
    ChatInputCommandInteraction
} from 'discord.js';
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';
import { 
    Config, 
    Bot,
    GuildInfo,
    Voice
} from '@dcbotTypes';
import { 
    buildSlashCommands, 
    cmd_handler 
} from '@cmd';
import utils from '@utils';

export class Tomori implements Bot {
    client: Client;
    token: string;
    mongoURI: string;
    clientId: string;
    config: Config;
    guildInfo: Record<string, GuildInfo>;

    slashCommands?: RESTPostAPIChatInputApplicationCommandsJSONBody[];
    slashCommandsHandler?: Map<string, Function>;
    voice?: Voice;

    constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        this.client = client;
        this.token = token;
        this.mongoURI = mongoURI;
        this.clientId = clientId;
        this.config = config;
        this.guildInfo = {};
    }

    login = async () => {
        await this.client.login(this.token);
    }

    registerGuild = () => {
        utils.consoleLogger("Registering guilds...");
        try {
            this.config.guilds.forEach((config) => {
                let newChannel: Record<string, Channel> = {};
                Object.entries(config.channels).forEach(([name, id]) => {
                    const channel = this.client.channels.cache.get(id);
                    if (channel) {
                        newChannel[name] = channel;
                    }
                });
                let newGuild: GuildInfo = {
                    bot_name: this.client.guilds.cache.get(config.guild_id)?.members.cache.get(this.clientId)?.displayName as string,
                    guild: this.client.guilds.cache.get(config.guild_id) as Guild,
                    channels: newChannel
                };
                this.guildInfo[config.guild_id] = newGuild;
            });

            utils.consoleLogger("Successfully registered all guilds.");
        } catch (err) {
            utils.consoleLogger(`Cannot register guild: ${err}`);
        }
    }

    initSlashCommands = () => {
        this.slashCommands = this.config.commands.map((cmd) => {
            return buildSlashCommands(cmd);
        });
    }

    initSlashCommandsHandlers = () => {
        this.slashCommandsHandler = new Map<string, Function>();
        Object.entries(cmd_handler).forEach(([name, handler]) => {
            if (typeof handler === 'function') {
                this.slashCommandsHandler?.set(name, handler);
            }
        });
    }

    registerSlashCommands = async () => {
        utils.consoleLogger("Register commands...");

        const rest = new REST().setToken(this.token)
        Object.entries(this.guildInfo).forEach(async ([guildId, guildInfo]) => {
            await rest.put(
                Routes.applicationGuildCommands(this.clientId, guildId), {
                body: this.slashCommands
            })
            .then(() =>
                utils.consoleLogger(`Successfully register ${this.slashCommands?.length} application (/) commands.`)
            )
            .catch((err) => {
                utils.consoleLogger(`Failed to register application (/) commands: ${err}`);
            });
        });
    }

    executeSlashCommands = async (interaction: ChatInputCommandInteraction) => {
        if (!interaction.isCommand()) return;

        const command = this.config.commands.find((cmd) => cmd.name === interaction.commandName);
        if (command) {
            try {
                const handler = this.slashCommandsHandler?.get(interaction.commandName)
                if (handler) {
                    await handler(interaction, this);
                }
            } catch (error) {
                console.error(error);
            }
        }
    }

    initVoice = () => {
        this.voice = {
            recorder: new VoiceRecorder({}, this.client),
            connection: null
        }
    }
}