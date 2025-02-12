import { 
    Client,
    REST,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    Routes,
    Guild,
    Channel,
    TextChannel,
    PublicThreadChannel,
    ChatInputCommandInteraction,
    GuildMember,
    Role
} from 'discord.js';
import { VoiceConnection } from "@discordjs/voice";
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';
import db from '@db';
import utils from '@utils';
import {
    buildSlashCommands,
    cmd_handler
} from '@cmd';
import { Connection, Model } from 'mongoose';

export class BaseBot {
    private token: string;
    private mongoURI?: string;
    public adminId?: string;
    public client: Client;
    public clientId: string;
    public config: Config;
    public guildInfo: Record<string, GuildInfo>;
    
    public slashCommands?: RESTPostAPIChatInputApplicationCommandsJSONBody[];
    public slashCommandsHandler?: Map<string, Function>;
    public voice?: Voice;

    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        this.client = client;
        this.token = token;
        this.mongoURI = mongoURI;
        this.clientId = clientId;
        this.config = config;
        this.guildInfo = {};
    }

    public login = async () => {
        utils.systemLogger(this.clientId, "Logging in...");
        await this.client.login(this.token);
        if (!this.client.user) {
            utils.systemLogger(this.clientId, "Cannot login.");
            return;
        }
        utils.systemLogger(this.clientId, `Logged in as ${this.client.user.username}!`);

        if (this.config.admin) {
            this.adminId = this.config.admin;
        }
    }

    public registerGuild = () => {
        utils.systemLogger(this.clientId, "Registering guilds...");
        try {            
            let guild_num = 0;
            this.client.guilds.cache.forEach((guild) => {
                const config = this.config.guilds?.[guild.id];
                
                let newChannel: Record<string, Channel> = {};
                let newRole: Record<string, Role> = {};
                if (config) {
                    // register channels
                    Object.entries(config.channels).forEach(([name, id]) => {
                        const channel = this.client.channels.cache.get(id);
                        if (channel) {
                            newChannel[name] = channel;
                        }
                    });
    
                    // register roles
                    Object.entries(config.roles).forEach(([name, id]) => {
                        const role = guild.roles.cache.get(id);
                        newRole[name] = role as Role;
                    });
                }

                let newGuild: GuildInfo = {
                    bot_name: guild.members.cache.get(this.clientId)?.displayName as string,
                    guild: guild,
                    channels: newChannel,
                    roles: newRole
                };
                this.guildInfo[guild.id] = newGuild;
                guild_num++;
                utils.systemLogger(this.clientId, `${guild_num}. ${guild.id} - ${guild.name}`);
            });

            utils.systemLogger(this.clientId, "Successfully registered all guilds.");
        } catch (err) {
            utils.systemLogger(this.clientId, `Cannot register guild: ${err}`);
        }
    }

    public connectGuildDB = async () => {
        utils.systemLogger(this.clientId, "Connecting to MongoDB...");
        if (!this.mongoURI) {
            utils.systemLogger(this.clientId, "No MongoDB URI.");
            return;
        }

        try {
            await Promise.all(Object.entries(this.guildInfo).map(async ([guild_id, guild]) => {

                const database = await db.dbConnect(this.mongoURI!, guild_id, this.clientId);
                if (database && this.guildInfo[guild_id]) {
                    this.guildInfo[guild_id].db = database;
                    utils.systemLogger(this.clientId, `MongoDB for guild: ${guild_id} - ${guild.guild.name} connected.`);
                } else {
                    utils.systemLogger(this.clientId, `Cannot connect to MongoDB for guild ${guild_id}.`);
                }
            }));
        } catch (err) {
            utils.systemLogger(this.clientId, `Cannot connect to MongoDB: ${err}`);
        }
    }

    public initSlashCommandsHandlers = () => {
        this.slashCommandsHandler = new Map<string, Function>();
        Object.entries(cmd_handler).forEach(([name, handler]) => {
            if (typeof handler === 'function') {
                this.slashCommandsHandler?.set(name, handler);
            }
        });
    }

    public registerSlashCommands = async () => {
        utils.systemLogger(this.clientId, "Registering commands...");

        if (!this.config.commands) {
            utils.systemLogger(this.clientId, "No commands to register.");
            return;
        }

        // build slash commands from config
        this.slashCommands = [];
        this.config.commands.forEach((cmd) => {
            let slashCommand = buildSlashCommands(cmd);
            this.slashCommands?.push(slashCommand);
        });

        // register slash commands to discord
        const rest = new REST().setToken(this.token)
        await rest.put(Routes.applicationCommands(this.clientId), { body: [] })
        .catch((err) => {
            utils.systemLogger(this.clientId, `Failed to clear application (/) commands: ${err}`);
        });

        Object.entries(this.guildInfo).forEach(async ([guildId, guildInfo]) => {
            await rest.put(Routes.applicationGuildCommands(this.clientId, guildId), { body: this.slashCommands })
            .catch((err) => {
                utils.systemLogger(this.clientId, `Failed to register guild (/) commands: ${err}`);
            });
        });

        utils.systemLogger(this.clientId, `Successfully register ${this.slashCommands.length} application (/) commands.`)
    }

    public executeSlashCommands = async (bot: BaseBot, interaction: ChatInputCommandInteraction) => {
        if (!interaction.isCommand()) return;
        if (!this.config.commands) {
            interaction.reply({ content: "No commands to execute.", ephemeral: true });
            return;
        }
        if (!this.slashCommandsHandler) {
            interaction.reply({ content: "No command handler found.", ephemeral: true });
            return;
        }

        const command = this.config.commands.find((cmd) => cmd.name === interaction.commandName);
        if (command) {
            try {
                const handler = this.slashCommandsHandler.get(interaction.commandName)
                if (handler) {
                    await handler(interaction, this);
                }
            } catch (error) {
                utils.errorLogger(this.clientId, error);
            }
        }
        
        const channel_log = `Command: /${interaction.commandName}, User: ${interaction.user.displayName}, Channel: <#${interaction.channel?.id}>`;
        utils.channelLogger(bot.guildInfo[interaction.guildId as string]?.channels?.debug, undefined, channel_log);
        const guild_log = `Command: /${interaction.commandName}, User: ${interaction.user.displayName}, Channel: ${interaction.guild?.channels.cache.get(interaction.channelId)?.name}`;
        utils.guildLogger(this.clientId, 'interaction_create', guild_log, interaction.guild?.name as string);
    }
    
    public initVoice = () => {
        this.voice = {
            recorder: new VoiceRecorder({}, this.client),
            connection: null
        }
    }

    public rebootMessage = async () => {
        Object.entries(this.guildInfo).forEach(async ([guild_id, guild]) => {
            try {
                const debug_ch = this.guildInfo[guild_id]?.channels?.debug as AllowedTextChannel;
                if (debug_ch) {
                    await debug_ch.send(`${guild.bot_name}重開機囉!`);
                }
            } catch (error) {
                utils.errorLogger(this.clientId, error);
            }
        });
    }

    public getToken = () => {
        return this.token;
    }
    
    public getMongoURI = () => {
        return this.mongoURI;
    }
}

export interface Config {
    admin?: string;
    guilds?: Record<string, GuildConfig>;
    identities?: Record<string, Identity>;
    commands?: Command[];
}

export interface GuildInfo {
    bot_name: string;
    guild: Guild
    channels?: Record<string, Channel>;
    roles?: Record<string, Role>;
    db?: {
        connection: Connection;
        models: Record<string, Model<any>>;
    }
}

interface GuildConfig {
    channels: Record<string, string>;
    roles: Record<string, string>;
}

interface Identity {
    avatar_url: string;
    color_role?: string;
}

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

export interface Voice {
    recorder: VoiceRecorder;
    connection: VoiceConnection | null;
}

export type AllowedTextChannel = TextChannel | PublicThreadChannel;