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
    MessageFlags,
} from 'discord.js';
import { VoiceConnection } from "@discordjs/voice";
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';
import db, { type GuildDb, getMongoConnectionManagerForUri } from '@db';
import {
  createContainer,
  TOKENS,
  type ServiceContainer,
  type ReposFactory,
} from '../core/ioc';
import { asGuildId } from '../core/ids';
import { buildRepos, type Repos } from '../persistence/repositories';
import type { ConnectionManager } from '../infra/mongo/connection-manager';
import {
  createLoggerFromProcessEnv,
  installProcessHandlers,
  type Logger,
} from '../core/logger';
import { initLegacyLogger } from '../utils/logger';
import { Job } from 'node-schedule';
import { Command, registerCommands, executeCommand } from "@cmd";
import { ButtonHandler, registerButtons, executeButton } from '@button';
import { ModalHandler, registerModals, executeModal } from '@modal';
import { registerSSMs, SSMHandler, executeSSM } from '@ssm';
import { logger } from "@utils";
import { auto_reply, detectGuildCreate, detectGuildMemberUpdate, detectMessageDelete, detectMessageUpdate } from "@event";
import { ReactionHandler, executeReactionAdded, executeReactionRemoved, registerReactions } from "@reaction";
import { giveaway, activity } from "@features";

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
    /** @deprecated Use `repos` for typed access. Kept for unmigrated callsites; removed in Phase 4b. */
    db?: GuildDb;
    /** Per-guild repository bag built from the IoC container at connect time. */
    repos?: Repos;
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

    /**
     * Composition-root IoC container. Owned by BaseBot, populated in
     * the constructor with `ConnectionManager` + `ReposFactory`. Other
     * layers must NOT import this container — handlers reach repos via
     * `bot.guildInfo[guildId].repos`. The eslint `no-restricted-imports`
     * rule enforces the constraint.
     */
    public readonly container: ServiceContainer;

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

        this.container = createContainer();
        // Logger is the first registration so downstream factories may
        // resolve it for their own structured logs. The instance is
        // bound with `{ bot: clientId }` so every line carries the bot
        // identity without callers passing it explicitly.
        this.container.registerSingleton(TOKENS.Logger, () =>
            createLoggerFromProcessEnv({ bot: this.clientId }),
        );
        // ConnectionManager is keyed by URI through `getMongoConnectionManagerForUri`,
        // shared with the legacy `db.dbConnect()` shim — one pool per process per URI.
        const uri = this.mongoURI;
        this.container.registerSingleton(TOKENS.ConnectionManager, () => {
            if (uri === undefined || uri.length === 0) {
                throw new Error(
                    'BaseBot: ConnectionManager resolved but no MONGO_URI was supplied to the bot constructor.',
                );
            }
            return getMongoConnectionManagerForUri(uri);
        });
        const reposFactory: ReposFactory = async (guildId: ReturnType<typeof asGuildId>) => {
            const cm = this.container.resolve<ConnectionManager>(TOKENS.ConnectionManager);
            const guildConn = await cm.getConnection(guildId);
            return buildRepos(guildConn);
        };
        this.container.registerSingleton(TOKENS.ReposFactory, () => reposFactory);
    }

    /**
     * Open (or reuse) the per-guild MongoDB connection and populate
     * BOTH `guildInfo[g].db` (legacy shape, for unmigrated callsites)
     * and `guildInfo[g].repos` (typed bag, for new code).
     *
     * Reused by the startup loop in {@link connectGuildDB} and by the
     * new-guild-join path in `src/events/guild_event.ts`.
     */
    public connectOneGuild = async (guildId: string): Promise<void> => {
        const slot = this.guildInfo[guildId];
        if (slot === undefined) {
            logger.systemLogger(this.clientId, `connectOneGuild: no guildInfo slot for ${guildId}`);
            return;
        }
        const branded = asGuildId(guildId);
        // Resolve through the registered ReposFactory so the registration
        // is exercised by the only consumer (single code path; future
        // composition roots get the same builder).
        const reposFactory = this.container.resolve<ReposFactory>(TOKENS.ReposFactory);
        const repos = await reposFactory(branded);
        const cm = this.container.resolve<ConnectionManager>(TOKENS.ConnectionManager);
        // The connection is cached inside ConnectionManager so this is the
        // same instance the factory just built repos against.
        const guildConn = await cm.getConnection(branded);
        slot.db = { connection: guildConn.connection, models: guildConn.models };
        slot.repos = repos;
    }

    public run = async (callback?: () => Promise<void>) => {
        // Wire the structured logger before any handler runs so legacy
        // `logger.systemLogger(...)` callsites route through the same
        // bot-scoped pino instance the IoC container holds.
        const rootLogger = this.container.resolve<Logger>(TOKENS.Logger);
        initLegacyLogger(rootLogger);
        // Process-level safety net. `installProcessHandlers` is
        // idempotent so multi-bot processes (one node process running
        // >1 BaseBot) install exactly once.
        installProcessHandlers({
            logger: rootLogger,
            gracefulShutdown: () => this.shutdown(),
        });
        await this.login();
        await this.init(callback);
        await this.listen();
    }

    /**
     * Best-effort graceful shutdown invoked by the
     * `uncaughtException` handler. Override in subclasses to add
     * bot-specific teardown. The default closes the Discord client +
     * mongo connections via the shared {@link ConnectionManager}.
     */
    public shutdown = async (): Promise<void> => {
        const log = this.container.tryResolve<Logger>(TOKENS.Logger);
        try {
            this.client.destroy();
        } catch (e: unknown) {
            // Best-effort: log so ops sees why teardown couldn't reach a
            // clean state, but the process is already on the fatal path
            // and will exit shortly regardless.
            log?.warn(
                { err: e instanceof Error ? e : new Error(String(e)) },
                'shutdown: client.destroy threw',
            );
        }
        try {
            const cm = this.container.tryResolve<ConnectionManager>(TOKENS.ConnectionManager);
            await cm?.closeAll();
        } catch (e: unknown) {
            log?.warn(
                { err: e instanceof Error ? e : new Error(String(e)) },
                'shutdown: connection manager closeAll threw',
            );
        }
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
                await activity.rebootActivityJobs(this);

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
                try {
                    await this.connectOneGuild(guild_id);
                    logger.systemLogger(this.clientId, `MongoDB for guild: ${guild_id} - ${guild.guild.name} connected.`);
                } catch (err) {
                    logger.systemLogger(this.clientId, `Failed to connect to MongoDB for guild ${guild_id}: ${err}`);
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
                    await interaction.reply({ content: '目前尚不支援此類型的指令', flags: MessageFlags.Ephemeral });
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