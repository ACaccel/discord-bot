import { 
    Client,
    Events,
    Guild,
    Channel,
    Role,
    Message,
    PartialMessage,
    GuildMember,
    PartialGuildMember,
    MessageReaction,
    PartialMessageReaction,
    Interaction,
    User,
    PartialUser,
} from "discord.js";
import { VoiceConnection } from "@discordjs/voice";
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';
import { Connection, Model } from "mongoose";
import { Job } from 'node-schedule';
import { Command, registerCommands, executeCommand } from "@cmd";
import { ButtonHandler, registerButtons, executeButton } from '@button';
import { ModalHandler, registerModals, executeModal } from '@modal';
import { registerSSMs, SSMHandler, executeSSM } from '@ssm';
import db from '@db';
import { logger } from "@utils";
import { auto_reply, detectGuildCreate, detectGuildMemberUpdate, detectMessageDelete, detectMessageUpdate } from "@event";
import { ReactionHandler, executeReactionAdded, executeReactionRemoved, registerReactions } from "@reaction";
import { giveaway } from "@features";

export interface Config {
    admin?: string;
    guilds?: Record<string, GuildConfig>;
    commands?: string[];
}

export interface GuildInfo {
    bot_name: string;
    guild: Guild;
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

export interface Voice {
    recorder: VoiceRecorder;
    connection: VoiceConnection | null;
}

export abstract class BaseBot<TConfig extends Config = Config> {
    private token: string;
    private mongoURI?: string;
    public adminId?: string;
    public client: Client;
    public clientId: string;
    public config: TConfig;
    public guildInfo: Record<string, GuildInfo>;

    public commandHandlers: Map<string, Command>;
    public buttonHandler: Map<string, ButtonHandler>;
    public ssmHandler: Map<string, SSMHandler>;
    public modalHandler: Map<string, ModalHandler>;
    public reactionHandler: Map<string, ReactionHandler>;
    public voice?: Voice;

    public help_msg: string;
    public jobs: Map<string, Job>;

    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TConfig) {
        this.token = token;
        this.mongoURI = mongoURI;
        this.client = client;
        this.clientId = clientId;
        this.config = config;
        this.guildInfo = {};

        this.commandHandlers = new Map<string, Command>();
        this.buttonHandler = new Map<string, ButtonHandler>();
        this.ssmHandler = new Map<string, SSMHandler>();
        this.modalHandler = new Map<string, ModalHandler>();
        this.reactionHandler = new Map<string, ReactionHandler>();

        this.help_msg = '';
        this.jobs = new Map<string, Job>();
    }

    public run = async (callback?: () => Promise<void>) => {
        await this.login();
        await this.init(callback);
        await this.listen();
    }

    public login = async () => {
        logger.systemLogger(this.clientId, "Logging in...");
        await this.client.login(this.token)
        .catch((err) => {
            logger.systemLogger(this.clientId, `Failed to login: ${err}`);
        });
        if (!this.client.user) {
            logger.systemLogger(this.clientId, "Failed to login: No user found.");
            return;
        }
        logger.systemLogger(this.clientId, `Logged in as ${this.client.user.username}!`);

        if (this.config.admin) {
            this.adminId = this.config.admin;
        }
    }

    public init = async (callback?: () => Promise<void>) => {
        this.client.once(Events.ClientReady, async () => {
            try {
                this.registerGuild();
                await this.connectGuildDB();
                await registerCommands(this);
                await registerButtons(this);
                await registerSSMs(this);
                await registerModals(this);
                await registerReactions(this);
                await giveaway.rebootGiveawayJobs(this);

                await this.rebootMessage();
                if (callback) {
                    await callback();
                }
            } catch (err) {
                logger.errorLogger(this.clientId, null, err);
            }
        });
    }
    
    public listen = async () => {
        this.client.on(Events.InteractionCreate, async (interaction) => {
            await this.interactionEventListener(interaction).catch((err) => {
                logger.errorLogger(this.clientId, interaction.guildId || null, err);
            });
        });
        this.client.on(Events.MessageCreate, async (message) => {
            await this.messageCreateListener(message).catch((err) => {
                logger.errorLogger(this.clientId, message.guildId || null, err);
            });
        });
        this.client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
            await this.messageUpdateListener(oldMessage, newMessage).catch((err) => {
                logger.errorLogger(this.clientId, newMessage.guildId || null, err);
            });
        });
        this.client.on(Events.MessageDelete, async (message) => {
            await this.messageDeleteListener(message).catch((err) => {
                logger.errorLogger(this.clientId, message.guildId || null, err);
            });
        });
        this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
            await this.messageReactionAddListener(reaction, user).catch((err) => {
                logger.errorLogger(this.clientId, reaction.message.guildId || null, err);
            });
        });
        this.client.on(Events.MessageReactionRemove, async (reaction, user) => {
            await this.messageReactionRemoveListener(reaction, user).catch((err) => {
                logger.errorLogger(this.clientId, reaction.message.guildId || null, err);
            });
        });
        this.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
            await this.guildMemberUpdateListener(oldMember, newMember).catch((err) => {
                logger.errorLogger(this.clientId, newMember.guild.id || null, err);
            });
        });
        this.client.on(Events.GuildCreate, async (guild) => {
            await this.guildCreateListener(guild).catch((err) => {
                logger.errorLogger(this.clientId, guild.id || null, err);
            });
        });
    }

    public getMongoURI = () => {
        return this.mongoURI;
    }

    public getToken = () => {
        return this.token;
    }

    /********** Registration Methods **********/

    public reLogin = async () => {
        await this.client.login(this.token);
    }

    public registerGuild = () => {
        logger.systemLogger(this.clientId, "Registering guilds...");
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
                logger.systemLogger(this.clientId, `${guild_num}. ${guild.id} - ${guild.name}`);
            });

            logger.systemLogger(this.clientId, "Successfully registered all guilds.");
        } catch (err) {
            logger.systemLogger(this.clientId, `Cannot register guild: ${err}`);
        }
    }

    public connectGuildDB = async () => {
        logger.systemLogger(this.clientId, "Connecting to MongoDB...");
        if (!this.mongoURI) {
            logger.systemLogger(this.clientId, "No MongoDB URI.");
            return;
        }

        try {
            await Promise.all(Object.entries(this.guildInfo).map(async ([guild_id, guild]) => {
                const database = await db.dbConnect(this.mongoURI!, guild_id)
                .catch((err) => {
                    logger.systemLogger(this.clientId, `Failed to connect to MongoDB for guild ${guild_id}: ${err}`);
                });
                if (database && this.guildInfo[guild_id]) {
                    this.guildInfo[guild_id].db = database;
                    logger.systemLogger(this.clientId, `MongoDB for guild: ${guild_id} - ${guild.guild.name} connected.`);
                } else {
                    logger.systemLogger(this.clientId, `Failed to connect to MongoDB for guild ${guild_id}.: database is null or guildInfo is null`);
                }
            }));
        } catch (err) {
            logger.systemLogger(this.clientId, `Failed to connect to MongoDB: ${err}`);
        }
    }

    public rebootMessage = async () => {
        Object.entries(this.guildInfo).forEach(async ([guild_id, guild]) => {
            const guildInfo = this.guildInfo[guild_id];
            if (guildInfo && guildInfo.channels && guildInfo.channels.debug) {
                const debug_ch = guildInfo.channels.debug;
                if (debug_ch.isSendable()) {
                    await debug_ch.send(`${guild.bot_name}重開機囉!`);
                }
            }
        });
    }

    /********** Event Listeners **********/

    public interactionEventListener = async (interaction: Interaction): Promise<void> => {
        switch (true) {
            case interaction.isChatInputCommand() || interaction.isContextMenuCommand():
                await executeCommand(interaction, this);
                break;
            case interaction.isModalSubmit():
                await executeModal(interaction, this);
                break;
            case interaction.isButton():
                await executeButton(interaction, this);
                break;
            case interaction.isStringSelectMenu():
                await executeSSM(interaction, this);
                break;
            default:
                if (!interaction.isAutocomplete()) {
                    await interaction.reply({ content: '目前尚不支援此類型的指令', ephemeral: true });
                }
                break;
        }
    }

    public messageCreateListener = async (message: Message): Promise<void> => {
        if (message.guildId)
            await auto_reply(message, this, message.guildId);
    }

    public messageUpdateListener = async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> => {
        await detectMessageUpdate(oldMessage, newMessage, this);
    }

    public messageDeleteListener = async (message: Message | PartialMessage): Promise<void> => {
        await detectMessageDelete(message, this);
    }

    public messageReactionAddListener = async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> => {
        const fetchedReaction = reaction.partial ? await reaction.fetch() : reaction;
        const fetchedUser = user.partial ? await user.fetch() : user;

        if (!user.bot) {
            await executeReactionAdded(fetchedReaction, fetchedUser, this);
        }
    }

    public messageReactionRemoveListener = async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> => {
        const fetchedReaction = reaction.partial ? await reaction.fetch() : reaction;
        const fetchedUser = user.partial ? await user.fetch() : user;

        if (!user.bot) {
            await executeReactionRemoved(fetchedReaction, fetchedUser, this);
        }
    }

    public guildMemberUpdateListener = async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember | PartialGuildMember): Promise<void> => {
        detectGuildMemberUpdate(oldMember, newMember, this);
    }

    public guildCreateListener = async (guild: any): Promise<void> => {
        detectGuildCreate(guild, this);
    }
}