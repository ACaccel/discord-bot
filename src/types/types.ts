import { 
    Client,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    Guild,
    Channel,
    TextChannel,
    PublicThreadChannel,
    ChatInputCommandInteraction,
    Role,
    ModalSubmitInteraction,
    ButtonInteraction,
    StringSelectMenuInteraction
} from 'discord.js';
import { VoiceConnection } from "@discordjs/voice";
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';
import db from '@db';
import utils from '@utils';
import {
    buildSlashCommands,
    cmd_handler,
    modal_handler,
    button_handler,
    ssm_handler
} from '@cmd';
import { Connection, Model } from 'mongoose';
import slash_command_config from '../slash_command.json';

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
    public modalHandler?: Map<string, Function>;
    public buttonHandler?: Map<string, Function>;
    public stringSelectMenuHandler?: Map<string, Function>;
    public voice?: Voice;

    public help_msg: string;

    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        this.client = client;
        this.token = token;
        this.mongoURI = mongoURI;
        this.clientId = clientId;
        this.config = config;
        this.guildInfo = {};
        this.help_msg = '';
    }

    public login = async () => {
        utils.systemLogger(this.clientId, "Logging in...");
        await this.client.login(this.token)
        .catch((err) => {
            utils.systemLogger(this.clientId, `Failed to login: ${err}`);
        });
        if (!this.client.user) {
            utils.systemLogger(this.clientId, "Failed to login: No user found.");
            return;
        }
        utils.systemLogger(this.clientId, `Logged in as ${this.client.user.username}!`);

        // check configuration files
        if (!slash_command_config) {
            utils.systemLogger(this.clientId, "Please setup your slash_command.json file.");
            return;
        }

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
                const database = await db.dbConnect(this.mongoURI!, guild_id, this.clientId)
                .catch((err) => {
                    utils.systemLogger(this.clientId, `Failed to connect to MongoDB for guild ${guild_id}: ${err}`);
                });
                if (database && this.guildInfo[guild_id]) {
                    this.guildInfo[guild_id].db = database;
                    utils.systemLogger(this.clientId, `MongoDB for guild: ${guild_id} - ${guild.guild.name} connected.`);
                } else {
                    utils.systemLogger(this.clientId, `Failed to connect to MongoDB for guild ${guild_id}.: database is null or guildInfo is null`);
                }
            }));
        } catch (err) {
            utils.systemLogger(this.clientId, `Failed to connect to MongoDB: ${err}`);
        }
    }

    public rebootMessage = async () => {
        Object.entries(this.guildInfo).forEach(async ([guild_id, guild]) => {
            const guildInfo = this.guildInfo[guild_id];
            if (guildInfo && guildInfo.channels && guildInfo.channels.debug) {
                const debug_ch = guildInfo.channels.debug as AllowedTextChannel;
                if (debug_ch) {
                    await debug_ch.send(`${guild.bot_name}重開機囉!`);
                }
            }
        });
    }

    public initVoice = () => {
        this.voice = {
            recorder: new VoiceRecorder({}, this.client),
            connection: null
        }
    }

    public getToken = () => {
        return this.token;
    }
    
    public getMongoURI = () => {
        return this.mongoURI;
    }

    //============================================//
    //============== slash commands ==============//
    //============================================//
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

        try {
            if (!this.config.commands) {
                utils.systemLogger(this.clientId, "No commands to register.");
                return;
            }

            // build slash commands from config
            this.slashCommands = [];
            this.config.commands.forEach((cmd) => {
                const command_config = slash_command_config.find((config) => config.name === cmd);
                if (command_config) {
                    let slashCommand = buildSlashCommands(command_config);
                    this.slashCommands?.push(slashCommand);
                }
            });

            await this.client.application?.commands.set([]);
            await Promise.all(
                Object.entries(this.guildInfo).map(async ([guildId, guildInfo]) => {
                    await this.client.application?.commands.set(this.slashCommands || [], guildId);
                })
            );

            utils.systemLogger(this.clientId, `Successfully register ${this.slashCommands.length} application (/) commands.`)
        } catch (err) {
            utils.systemLogger(this.clientId, `Failed to register commands: ${err}`);
        }
    }

    public executeSlashCommands = async (interaction: ChatInputCommandInteraction, blocked_channels?: string[]) => {
        if (!this.config.commands) {
            interaction.reply({ content: "Config of commands not found.", ephemeral: true });
            return;
        }
        if (!this.slashCommandsHandler) {
            interaction.reply({ content: "Command handler not found.", ephemeral: true });
            return;
        }

        const command = this.config.commands.find((cmd) => cmd === interaction.commandName);
        if (command) {
            const handler = this.slashCommandsHandler.get(interaction.commandName)
            if (handler) {
                await handler(interaction, this);
            }
        } else {
            interaction.reply({ content: "Command not found.", ephemeral: true });
        }
        
        
        const parentId = (interaction.channel as TextChannel).parentId as string;
        if (!(blocked_channels && (blocked_channels.includes(interaction.channelId) || blocked_channels.includes(parentId)))) {
            const channel_log = `Command: /${interaction.commandName}, User: ${interaction.user.displayName}, Channel: <#${interaction.channelId}>`;
            utils.channelLogger(this.guildInfo[interaction.guildId as string]?.channels?.debug, undefined, channel_log);
        }
        if (interaction.guild) {
            const guild_log = `Command: /${interaction.commandName}, User: ${interaction.user.displayName}, Channel: ${interaction.guild?.channels.cache.get(interaction.channelId)?.name}`;
            utils.guildLogger(this.clientId, interaction.guild.id, 'interaction_create', guild_log, interaction.guild?.name as string);
        }
    }

    //=============================================//
    //============== modal commands ===============//
    //=============================================//
    public initModalHandlers = () => {
        this.modalHandler = new Map<string, Function>()
        Object.entries(modal_handler).forEach(([name, handler]) => {
            if (typeof handler === 'function') {
                this.modalHandler?.set(name, handler);
            }
        });
    }

    public executeModalSubmit = async (interaction: ModalSubmitInteraction) => {
        if (!this.modalHandler) {
            interaction.reply({ content: "Modal handler not found.", ephemeral: true });
            return;
        }

        const handler = this.modalHandler.get(interaction.customId);
        if (handler) {
            await handler(interaction, this);
        }
    }

    //=============================================//
    //============== button commands ==============//
    //=============================================//
    public initButtonHandlers = () => {
        this.buttonHandler = new Map<string, Function>();
        Object.entries(button_handler).forEach(([name, handler]) => {
            if (typeof handler === 'function') {
                this.buttonHandler?.set(name, handler);
            }
        });
    }

    public executeButton = async (interaction: ButtonInteraction) => {
        if (!this.buttonHandler) {
            interaction.reply({ content: "Button handler not found.", ephemeral: true });
            return;
        }

        // customId format: <button_type>|<button_value>
        const button_type = interaction.customId.split('|')[0];
        const handler = this.buttonHandler.get(button_type);
        if (handler) {
            await handler(interaction, this);
        }
    }
    
    //=============================================//
    //============ string select menu =============//
    //=============================================//
    public initStringSelectMenuHandlers = () => {
        this.stringSelectMenuHandler = new Map<string, Function>();
        Object.entries(ssm_handler).forEach(([name, handler]) => {
            if (typeof handler === 'function') {
                this.stringSelectMenuHandler?.set(name, handler);
            }
        });
    }

    public executeStringSelectMenu = async (interaction: StringSelectMenuInteraction) => {
        if (!this.stringSelectMenuHandler) {
            interaction.reply({ content: "String select menu handler not found.", ephemeral: true });
            return;
        }

        // customId format: <ssm_type|ssm_value>
        const ssm_type = interaction.customId.split('|')[0];
        const handler = this.stringSelectMenuHandler.get(ssm_type);
        if (handler) {
            await handler(interaction, this);
        }
    }
}

export interface Config {
    admin?: string;
    guilds?: Record<string, GuildConfig>;
    commands?: string[];
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