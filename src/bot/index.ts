import {
    Client,
    type ClientEvents,
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
import { createDefaultTranslator, type Translator } from '../core/i18n';
import { systemClock, type Clock } from '../core/time';
import { PluginHost, type Plugin } from '../core/plugin';
import type { GuildRegistry } from '../core/guild-registry';
import { Job } from 'node-schedule';
import { Command, registerCommands, executeCommand } from "@cmd";
import { ButtonHandler, registerButtons, executeButton } from '@button';
import { ModalHandler, registerModals, executeModal } from '@modal';
import { registerSSMs, SSMHandler, executeSSM } from '@ssm';
import { logger } from "@utils";
import { detectGuildCreate } from "@event";
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

    /**
     * PluginHost: lazily constructed in {@link run} once async Translator
     * initialisation has resolved. Subclasses stage plugins via
     * {@link use} between `new XBot(...)` and `bot.run()`; staged plugins
     * are flushed into the host as part of `run()`'s startup sequence.
     */
    private pluginHost: PluginHost | undefined;
    private readonly pendingPlugins: Array<{ plugin: Plugin<unknown>; config: unknown }> = [];

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
        // Clock is stateless and side-effect-free; the singleton is
        // bound at construction so plugins resolving via the typed
        // resolver get the production wall clock by default. Tests that
        // need a FakeClock build their own container.
        this.container.registerSingleton(TOKENS.Clock, () => systemClock);
        // GuildRegistry is a read-only view over `this.guildInfo`.
        // Plugins resolve it once during init and call lookup methods
        // inside event handlers instead of holding a BaseBot reference.
        // Implemented as an inline closure-bound impl so the bot's
        // composition root stays small; tests provide their own fake.
        const guildRegistry: GuildRegistry = {
            getRepos: (guildId) => this.guildInfo[guildId]?.repos,
            getChannel: (guildId, name) => this.guildInfo[guildId]?.channels?.[name],
            getRole: (guildId, name) => this.guildInfo[guildId]?.roles?.[name],
            listGuildIds: () => Object.keys(this.guildInfo),
        };
        this.container.registerSingleton(TOKENS.GuildRegistry, () => guildRegistry);
    }

    /**
     * Stage a plugin for registration. Idempotent across distinct ids;
     * duplicate ids are rejected later by {@link PluginHost.register}
     * during {@link run}'s flush step, so the failure carries the host's
     * structured `PluginRegistrationError` rather than an ad-hoc throw
     * here.
     *
     * Returns `this` for fluent composition in subclass constructors:
     * ```ts
     * super(...);
     * this.use(AutoReplyPlugin).use(GiveawayPlugin, giveawayConfig);
     * ```
     */
    public use = <Config>(plugin: Plugin<Config>, config?: Config): this => {
        this.pendingPlugins.push({
            plugin: plugin as Plugin<unknown>,
            config: config as unknown,
        });
        return this;
    }

    /**
     * Expose the host for tests and for subclasses that need to inspect
     * disabled-plugin state. Undefined before {@link run} has built it.
     */
    public getPluginHost = (): PluginHost | undefined => this.pluginHost;

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
        // Translator load is async (i18next.init); we register it as a
        // singleton holding the resolved instance so plugin init contexts
        // can call `resolve(TOKENS.Translator)` synchronously.
        const translator = await createDefaultTranslator();
        this.container.registerSingleton(TOKENS.Translator, () => translator);
        // Build the host now that Translator + Clock + Logger are all
        // bound. Phase 4b-1 passes empty core registries because the
        // legacy registerCommands/registerButtons/... paths still feed
        // the BaseBot's Map<>s directly; Phase 4b-3 fold codegen output
        // into PluginHostOptions.coreRegistries.
        const host = new PluginHost({
            container: this.container,
            logger: rootLogger,
            translator,
            clock: this.container.resolve<Clock>(TOKENS.Clock),
            coreRegistries: {},
        });
        for (const { plugin, config } of this.pendingPlugins) {
            host.register(plugin, config);
        }
        host.finalizeRegistration();
        // Building registries is a no-op when no plugin contributes
        // handlers; calling it here keeps the contract surface symmetric
        // for tests and ensures the merge fail-fast (duplicate handler
        // name) fires at startup rather than at first interaction.
        host.buildEffectiveRegistries();
        this.pluginHost = host;
        // init runs before client.login so plugins can resolve DI graph
        // (logger, repos factory) without observing a half-connected
        // Discord client; any critical failure surfaces before the bot
        // appears online.
        await host.initAll();
        await this.login();
        // start runs after login but BEFORE the EventDispatcher is
        // attached to client.on(...) — the dispatcher subscriptions are
        // collected by attachEventSubscriptions() inside startAll() and
        // the host doc requires we defer client.on() wiring until the
        // method returns.
        await host.startAll();
        this.attachDispatcherToClient(host);
        await this.init(callback);
        await this.listen();
    }

    /**
     * Forward every event a plugin currently subscribes to from the
     * Discord client into the host's EventDispatcher. One `client.on`
     * listener per subscribed event keeps the discord.js listener-count
     * cap predictable and avoids fanning unsubscribed events into the
     * dispatcher (cheap no-ops, but visible in profiling).
     *
     * MUST be invoked only after `host.startAll()` returns. Calling
     * earlier means plugins whose `start` hook hasn't completed could
     * still observe events. Enforced by ordering in {@link run}.
     */
    private attachDispatcherToClient = (host: PluginHost): void => {
        const dispatcher = host.getEventDispatcher();
        for (const event of dispatcher.subscribedEvents()) {
            // Type-narrow each event individually so the forwarded
            // `args` keeps the precise ClientEvents[event] tuple shape.
            // discord.js's `client.on` signature accepts the same tuple
            // so no further cast is needed at the call site.
            this.client.on(event, (...args: ClientEvents[typeof event]) => {
                void dispatcher.emit(event, ...args);
            });
        }
    }

    /**
     * Best-effort graceful shutdown invoked by the
     * `uncaughtException` handler. Override in subclasses to add
     * bot-specific teardown. The default closes the Discord client +
     * mongo connections via the shared {@link ConnectionManager}.
     */
    public shutdown = async (): Promise<void> => {
        const log = this.container.tryResolve<Logger>(TOKENS.Logger);
        // Run plugin onShutdown hooks (reverse topo order) BEFORE
        // tearing down the Discord client / Mongo pool, so a plugin that
        // wants to flush via either dependency still has access. Errors
        // inside onShutdown are already caught by PluginHost.
        if (this.pluginHost !== undefined) {
            try {
                await this.pluginHost.shutdownAll();
            } catch (e: unknown) {
                log?.warn(
                    { err: e instanceof Error ? e : new Error(String(e)) },
                    'shutdown: pluginHost.shutdownAll threw; continuing teardown',
                );
            }
        }
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
                // readyAll runs *inside* ClientReady so plugins observe
                // a fully-online client when their onReady hook fires.
                // Failures here are logged but never fatal — the bot is
                // already serving, mirroring host docstring policy.
                if (this.pluginHost !== undefined) {
                    try {
                        await this.pluginHost.readyAll();
                    } catch (readyErr: unknown) {
                        logger.errorLogger(this.clientId, null, readyErr);
                    }
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

    /**
     * Default no-op for `messageCreate`. Phase 4b-2 moved `auto_reply`
     * and `tts_reply` into {@link AutoReplyPlugin} / {@link TtsReplyPlugin};
     * bots opt in via `bot.use(AutoReplyPlugin)`. Subclasses (e.g.
     * Konata) still override this when they own a non-plugin chat flow;
     * Phase 4b-3 migrates those too.
     */
    public messageCreateListener = async (_message: Message): Promise<void> => {}

    /**
     * Default no-op for `messageUpdate`. Phase 4b-2 moved
     * `detectMessageUpdate` into {@link GuildEventsPlugin}.
     */
    public messageUpdateListener = async (
        _oldMessage: Message | PartialMessage,
        _newMessage: Message | PartialMessage,
    ): Promise<void> => {}

    /**
     * Default no-op for `messageDelete`. Phase 4b-2 moved
     * `detectMessageDelete` into {@link GuildEventsPlugin}.
     */
    public messageDeleteListener = async (_message: Message | PartialMessage): Promise<void> => {}

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

    /**
     * Default no-op for `guildMemberUpdate`. Phase 4b-2 moved
     * `detectGuildMemberUpdate` into {@link GuildEventsPlugin}.
     */
    public guildMemberUpdateListener = async (
        _oldMember: GuildMember | PartialGuildMember,
        _newMember: GuildMember | PartialGuildMember,
    ): Promise<void> => {}

    public guildCreateListener = async (guild: any): Promise<void> => {
        detectGuildCreate(guild, this);
    }
}