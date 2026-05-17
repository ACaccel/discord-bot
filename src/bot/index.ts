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
import { MongoConnectionManager } from '../infra/mongo/connection-manager';

/**
 * Process-wide pool of {@link MongoConnectionManager}s keyed by base
 * URI. Two BaseBots sharing a URI reuse the same manager (and thus
 * the same per-guild connection pool), and tests / multi-cluster
 * setups that pass distinct URIs get distinct managers. Audit C-2
 * inlined this here after the legacy `@db` shim that previously
 * exported the same map was deleted.
 */
const sharedConnectionManagers = new Map<string, MongoConnectionManager>();
const sharedConnectionManagerForUri = (uri: string): MongoConnectionManager => {
    const existing = sharedConnectionManagers.get(uri);
    if (existing !== undefined) return existing;
    const created = new MongoConnectionManager(uri);
    sharedConnectionManagers.set(uri, created);
    return created;
};
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
  installProcessHandlers,
  logError,
  logSystem,
  type Logger,
  ops,
} from '../core/logger';
import { createBootstrapLogger, loadEnv, type Env } from '../core/config';
import { createDefaultTranslator, type Translator } from '../core/i18n';
import { systemClock, type Clock } from '../core/time';
import {
    InteractionRouter,
    PluginHost,
    type InteractionContext,
    type Plugin,
} from '../core/plugin';
import {
    createChannelLoggingMiddleware,
    createDispatchMiddleware,
} from './middlewares';
import type { GuildRegistry } from '../core/guild-registry';
import { Job } from 'node-schedule';
import { Command, registerCommands } from "@cmd";
import { ButtonHandler, registerButtons } from '@button';
import { ModalHandler, registerModals } from '@modal';
import { registerSSMs, SSMHandler } from '@select-menu';

import { detectGuildCreate } from "@event";
import { ReactionHandler, executeReactionAdded, executeReactionRemoved, registerReactions } from "@reaction";

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
    /**
     * Guilds whose MongoDB initialisation has failed (audit 3.7).
     * Populated by `connectOneGuild` (both the startup fan-out AND the
     * new-guild-join path go through that single helper), cleared on
     * the next successful `connectOneGuild`. Each entry carries a
     * stable `traceId` so the user-facing
     * `errors:db.guild_disabled` message can be correlated to the
     * boot-time log line by `grep traceId=<id>`. Handlers consult the
     * map indirectly via `requireGuildRepos`.
     */
    public disabledGuilds: Map<string, { error: Error; traceId: string }> = new Map();

    public commandHandlers: Map<string, Command>;
    public buttonHandler: Map<string, ButtonHandler>;
    public ssmHandler: Map<string, SSMHandler>;
    public modalHandler: Map<string, ModalHandler>;
    public reactionHandler: Map<string, ReactionHandler>;
    public voice?: Voice;

    public help_msg: string;
    /**
     * Translator key for the bot's `/help` message body. Set by
     * subclasses (e.g. `Nijika`) in their constructor; resolved during
     * {@link run} once the translator is loaded and the rendered string
     * stored in {@link help_msg}. Keeping the key (rather than the
     * resolved text) in the subclass avoids hard-coded CJK in
     * composition roots — see audit 3.4 / i18n scanner scope.
     */
    protected helpMessageKey?: string;
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
     * Bot-scoped {@link Translator}. Set inside {@link run} once the
     * async i18next catalog load resolves. Handlers reach localised
     * strings via `bot.translator.t('key', { params })` without
     * needing to import the IoC container (which the
     * `no-restricted-imports` rule blocks for handler code).
     *
     * Optional only to model the pre-`run()` window; in any handler
     * context the field is guaranteed defined.
     */
    public translator: Translator | undefined;

    /**
     * Bot-scoped structured logger. Populated at the top of {@link run}
     * from the IoC container so handler callsites (which pre-date
     * constructor-injected loggers) can reach a typed pino instance
     * without resolving the container themselves. Mirrors the
     * {@link translator} access pattern.
     *
     * Optional only to model the pre-`run()` window; in any handler
     * context the field is guaranteed defined.
     */
    public logger: Logger | undefined;

    /**
     * PluginHost: lazily constructed in {@link run} once async Translator
     * initialisation has resolved. Subclasses stage plugins via
     * {@link use} between `new XBot(...)` and `bot.run()`; staged plugins
     * are flushed into the host as part of `run()`'s startup sequence.
     */
    private pluginHost: PluginHost | undefined;

    /**
     * Chain-of-Responsibility dispatcher for inbound interactions.
     * Built in {@link run} once the translator + clock are loaded;
     * `interactionEventListener` forwards every interaction through
     * the chain. Subclasses may inject extra middleware via
     * {@link configureInteractionRouter}.
     */
    protected interactionRouter: InteractionRouter | undefined;
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
            createBootstrapLogger({ bot: this.clientId }),
        );
        // ConnectionManager is process-shared via
        // `sharedConnectionManagerForUri` — one pool per URI keeps
        // multi-bot processes from opening duplicate Mongo connections.
        const uri = this.mongoURI;
        this.container.registerSingleton(TOKENS.ConnectionManager, () => {
            if (uri === undefined || uri.length === 0) {
                throw new Error(
                    'BaseBot: ConnectionManager resolved but no MONGO_URI was supplied to the bot constructor.',
                );
            }
            return sharedConnectionManagerForUri(uri);
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
        // Discord client singleton — plugins that need raw client
        // primitives (channel fetch, message archive) resolve through
        // here rather than holding a BaseBot reference.
        this.container.registerSingleton(TOKENS.DiscordClient, () => this.client);
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
     * `guildInfo[g].repos` with the typed repository bag. Audit C-2
     * (PR-E) retired the legacy `guildInfo[g].db` slot — `repos` is
     * now the only entry point.
     *
     * Reused by the startup loop in {@link connectGuildDB} and by the
     * new-guild-join path in `src/events/guild_event.ts`.
     */
    public connectOneGuild = async (guildId: string): Promise<void> => {
        const slot = this.guildInfo[guildId];
        if (slot === undefined) {
            logSystem(this.logger, this.clientId, ops.guildDb.slotMissing(guildId));
            return;
        }
        const branded = asGuildId(guildId);
        try {
            // Resolve the typed repository bag BEFORE touching `slot`
            // so a partial connect cannot leave a half-baked state.
            // The shared ConnectionManager primes its per-guild pool
            // inside reposFactory.
            const reposFactory = this.container.resolve<ReposFactory>(TOKENS.ReposFactory);
            const repos = await reposFactory(branded);
            // Single mutation — atomic from the handlers' point of view.
            slot.repos = repos;
            // Successful (re-)connect clears any prior disabled-marker so a
            // recovered guild stops returning `errors:db.guild_disabled`
            // on the next handler invocation. See audit 3.7.
            this.disabledGuilds.delete(guildId);
        } catch (err) {
            // Audit 3.7 plus reliability review: this is the single chokepoint
            // for "MongoDB unavailable for this guild" so BOTH callers (the
            // startup fan-out AND the new-guild-join path in
            // src/events/guild_event.ts) populate the same map. Generate a
            // stable trace id now so the user-facing message can be grep'd
            // against the log line below — see requireGuildRepos.
            const normalised =
                err instanceof Error
                    ? err
                    : new Error(typeof err === 'string' ? err : 'connectOneGuild failed');
            const traceId = Math.random().toString(36).slice(2, 8).padStart(6, '0');
            this.disabledGuilds.set(guildId, { error: normalised, traceId });
            logSystem(
                this.logger,
                this.clientId,
                ops.guildDb.connectFailed(guildId, traceId, normalised.message),
            );
            // Re-throw so existing callers (connectGuildDB, guild_event.ts)
            // keep their previous control-flow semantics.
            throw normalised;
        }
    }

    public run = async (callback?: () => Promise<void>) => {
        // Wire the structured logger before any handler runs so legacy
        // `logger.systemLogger(...)` callsites route through the same
        // bot-scoped pino instance the IoC container holds.
        const rootLogger = this.container.resolve<Logger>(TOKENS.Logger);
        this.logger = rootLogger;
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
        // Load the typed Env once at run() so plugins resolve LLM API
        // keys and other configuration through `TOKENS.Env` instead of
        // touching `process.env` directly. Failures here are
        // non-fatal: legacy bots still pass TOKEN / MONGO_URI / CLIENT_ID
        // through the constructor, so a deployment with a partially
        // valid env still boots. The structured warning lets ops see
        // when typed Env is unavailable so the no-restricted-syntax
        // rule is the only failure mode left for misconfigured keys.
        try {
            const env = loadEnv({
                exitOnFailure: false,
                requireDb: this.mongoURI !== undefined,
            });
            this.container.registerSingleton(TOKENS.Env, () => env);
        } catch (envErr: unknown) {
            rootLogger.warn(
                { err: envErr instanceof Error ? envErr : new Error(String(envErr)) },
                'BaseBot.run: typed Env load failed; TOKENS.Env will be unbound. Plugins requiring it (e.g. LlmChatPlugin) will fail at init.',
            );
        }
        const translator = await createDefaultTranslator();
        this.container.registerSingleton(TOKENS.Translator, () => translator);
        // Surface the resolved Translator on the bot itself so legacy
        // handlers (which still receive `bot: BaseBot` rather than a
        // per-interaction context) can call `bot.translator.t(...)`.
        // PR 6-2/6-3 migrates handlers; the field stays as the
        // canonical access point until the per-interaction ctx shape
        // lands.
        this.translator = translator;
        // Resolve the deferred help-message key now that the translator
        // is loaded. Subclasses set `helpMessageKey` in their ctor; the
        // composition root carries no inline user-facing CJK.
        if (this.helpMessageKey !== undefined) {
            this.help_msg = translator.t(this.helpMessageKey);
        }
        // Audit B-2: assemble the Chain-of-Responsibility interaction
        // router. Subclass-injected middleware runs FIRST (typical use
        // case: gate / filter / context-priming), then the terminal
        // dispatch + observability stages. The
        // `configureInteractionRouter` hook stays sync because routing
        // setup never needs IO — middleware itself owns the async
        // work.
        this.interactionRouter = new InteractionRouter();
        this.configureInteractionRouter(this.interactionRouter);
        this.interactionRouter.use(createDispatchMiddleware(this));
        this.interactionRouter.use(
            createChannelLoggingMiddleware(this, {
                blockedChannels: this.channelLoggingBlockedChannels(),
            }),
        );
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
        // Register the ClientReady listener BEFORE `client.login()`.
        // Pre-fix, `init()` ran AFTER login + startAll and so could
        // miss a `clientReady` event that already fired — observed as
        // Konata's "重開機囉!" reboot message silently disappearing
        // because `rebootMessage` only runs from inside that handler.
        // The latch lets the handler observe a fully-set-up host
        // (startAll done, dispatcher attached) before it invokes
        // `host.readyAll()` and the rest of the startup pipeline.
        let openReadyLatch: () => void = () => {};
        const readyLatch = new Promise<void>((resolve) => {
            openReadyLatch = resolve;
        });
        this.client.once(Events.ClientReady, async () => {
            await readyLatch;
            await this.handleClientReady(callback);
        });
        await this.login();
        // start runs after login but BEFORE the EventDispatcher is
        // attached to client.on(...) — the dispatcher subscriptions are
        // collected by attachEventSubscriptions() inside startAll() and
        // the host doc requires we defer client.on() wiring until the
        // method returns.
        await host.startAll();
        this.attachDispatcherToClient(host);
        openReadyLatch();
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
        logSystem(this.logger, this.clientId, "Logging in...");
        await this.client.login(this.token)
        .catch((err) => {
            logSystem(this.logger, this.clientId, `Failed to login: ${err}`);
        });
        if (!this.client.user) {
            logSystem(this.logger, this.clientId, "Failed to login: No user found.");
            return;
        }
        logSystem(this.logger, this.clientId, `Logged in as ${this.client.user.username}!`);

        if (this.config.admin) {
            this.adminId = this.config.admin;
        }
    }

    /**
     * Body of the `clientReady` handler. Extracted from the old
     * `init()` method so {@link run} can register the `once()`
     * listener BEFORE `client.login()` returns — that closes the
     * race that caused Konata's reboot message to silently drop.
     * The latch in {@link run} ensures this runs only after the
     * plugin host's `startAll` + dispatcher attach completes, so
     * `host.readyAll()` still observes the post-start invariants
     * the host contract requires.
     */
    private handleClientReady = async (callback?: () => Promise<void>): Promise<void> => {
        try {
            this.registerGuild();
            await this.connectGuildDB();
            await registerCommands(this);
            await registerButtons(this);
            await registerSSMs(this);
            await registerModals(this);
            await registerReactions(this);
            // Giveaway / activity reboot logic moved to
            // {@link createGiveawayPlugin} / {@link createActivityPlugin}
            // in Phase 4b-3. Bots that need them call `.use()`
            // with a `rebootJobs` closure in their composition root.
            await this.rebootMessage();
            if (callback) {
                await callback();
            }
            // readyAll runs *after* clientReady so plugins observe a
            // fully-online client when their onReady hook fires.
            // Failures here are logged but never fatal — the bot is
            // already serving, mirroring host docstring policy.
            if (this.pluginHost !== undefined) {
                try {
                    await this.pluginHost.readyAll();
                } catch (readyErr: unknown) {
                    logError(this.logger, this.clientId, null, readyErr);
                }
            }
        } catch (err) {
            logError(this.logger, this.clientId, null, err);
        }
    };
    
    public listen = async () => {
        this.client.on(Events.InteractionCreate, async (interaction) => {
            await this.interactionEventListener(interaction).catch((err) => {
                logError(this.logger, this.clientId, interaction.guildId || null, err);
            });
        });
        this.client.on(Events.MessageCreate, async (message) => {
            await this.messageCreateListener(message).catch((err) => {
                logError(this.logger, this.clientId, message.guildId || null, err);
            });
        });
        this.client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
            await this.messageUpdateListener(oldMessage, newMessage).catch((err) => {
                logError(this.logger, this.clientId, newMessage.guildId || null, err);
            });
        });
        this.client.on(Events.MessageDelete, async (message) => {
            await this.messageDeleteListener(message).catch((err) => {
                logError(this.logger, this.clientId, message.guildId || null, err);
            });
        });
        this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
            await this.messageReactionAddListener(reaction, user).catch((err) => {
                logError(this.logger, this.clientId, reaction.message.guildId || null, err);
            });
        });
        this.client.on(Events.MessageReactionRemove, async (reaction, user) => {
            await this.messageReactionRemoveListener(reaction, user).catch((err) => {
                logError(this.logger, this.clientId, reaction.message.guildId || null, err);
            });
        });
        this.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
            await this.guildMemberUpdateListener(oldMember, newMember).catch((err) => {
                logError(this.logger, this.clientId, newMember.guild.id || null, err);
            });
        });
        this.client.on(Events.GuildCreate, async (guild) => {
            await this.guildCreateListener(guild).catch((err) => {
                logError(this.logger, this.clientId, guild.id || null, err);
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
        logSystem(this.logger, this.clientId, "Registering guilds...");
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
                logSystem(this.logger, this.clientId, `${guild_num}. ${guild.id} - ${guild.name}`);
            });

            logSystem(this.logger, this.clientId, "Successfully registered all guilds.");
        } catch (err) {
            logSystem(this.logger, this.clientId, `Cannot register guild: ${err}`);
        }
    }

    public connectGuildDB = async () => {
        logSystem(this.logger, this.clientId, ops.guildDb.poolStart());
        if (!this.mongoURI) {
            logSystem(this.logger, this.clientId, ops.guildDb.uriMissing());
            return;
        }

        try {
            await Promise.all(Object.entries(this.guildInfo).map(async ([guild_id, guild]) => {
                try {
                    await this.connectOneGuild(guild_id);
                    logSystem(this.logger, this.clientId, ops.guildDb.connectSuccess(guild_id, guild.guild.name));
                } catch {
                    // connectOneGuild already populated `disabledGuilds`
                    // and logged with traceId; swallow here so one bad
                    // guild does not abort the fan-out. The disabled state
                    // is the durable record handlers consult.
                }
            }));
        } catch (err) {
            logSystem(this.logger, this.clientId, ops.guildDb.poolStartFailed(String(err)));
        }
    }

    public rebootMessage = async (): Promise<void> => {
        // Use awaited `Promise.all(map(async))` rather than
        // `forEach(async)` so the outer caller (handleClientReady)
        // genuinely waits for every send before continuing into
        // `pluginHost.readyAll`. Each per-guild send is wrapped in
        // `try/catch` so one failure cannot abort the whole fan-out;
        // failures are surfaced through the structured logger WITH
        // the guild id, so ops can attribute a failed send. No retry
        // here — the next boot re-enters this path; queuing retries
        // would only delay readyAll behind a flaky guild's channel.
        await Promise.all(
            Object.values(this.guildInfo).map(async (guild) => {
                try {
                    const debug_ch = guild.channels?.debug;
                    if (!debug_ch?.isSendable()) return;
                    const message =
                        this.translator?.t('replies:base_bot.reboot_notice', { botName: guild.bot_name }) ?? '';
                    if (message.length === 0) return;
                    await debug_ch.send(message);
                } catch (err) {
                    logError(this.logger, this.clientId, guild.guild.id, err);
                }
            }),
        );
    }

    /********** Event Listeners **********/

    /**
     * Subclass hook: append middleware to the bot's
     * {@link InteractionRouter} BEFORE the terminal dispatch /
     * channel-logging stages run. Default is a no-op. Subclasses MUST
     * NOT keep a reference to the router beyond this call — every
     * middleware should be self-contained.
     */
    protected configureInteractionRouter(_router: InteractionRouter): void {
        // default: no extra middleware
    }

    /**
     * Subclass hook returning channels (and parent thread channels)
     * whose slash-command activity should NOT be logged to the debug
     * channel. Default `undefined` means "log everything". Nijika
     * surfaces its `config.blocked_channels` here.
     */
    protected channelLoggingBlockedChannels(): readonly string[] | undefined {
        return undefined;
    }

    /**
     * Entry point Discord calls on every `InteractionCreate` event.
     *
     * **Final.** Subclasses MUST NOT override this — extend the bot by
     * pushing middleware through {@link configureInteractionRouter}
     * instead. The arrow-property + `readonly` modifier together
     * prevent both prototype-override and re-assignment, so a child
     * class accidentally restoring the pre-B-2 inline switch is a
     * compile error rather than a silent dispatch divergence.
     */
    public readonly interactionEventListener = async (interaction: Interaction): Promise<void> => {
        // Audit B-2: every interaction goes through the
        // Chain-of-Responsibility middleware stack. The router is
        // built inside `run()`; pre-`run()` (test paths) we fall
        // through to a minimal default reply.
        if (this.interactionRouter === undefined) {
            if (!interaction.isAutocomplete() && interaction.isRepliable()) {
                await interaction.reply({
                    content:
                        this.translator?.t('errors:command.handler_not_initialised') ?? '',
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
        const traceId = Math.random().toString(36).slice(2, 8).padStart(6, '0');
        const rootLogger = this.container.resolve<Logger>(TOKENS.Logger);
        const clock = this.container.resolve<Clock>(TOKENS.Clock);
        const translator = this.translator;
        if (translator === undefined) {
            // Defensive: translator is set immediately before the
            // router; either both are present or both absent. This
            // branch is unreachable in production but keeps strict
            // typing honest.
            return;
        }
        const ctx: InteractionContext = {
            interaction,
            traceId,
            logger: rootLogger.child({ traceId }),
            translator,
            clock,
            resolve: <T>(token: import('../core/ioc').ServiceToken<T>): T =>
                this.container.resolve<T>(token),
            state: new Map<string, unknown>(),
        };
        try {
            await this.interactionRouter.dispatch(ctx);
        } catch (err) {
            // Reviewer-flagged BLOCK: a dispatch-chain throw must still
            // produce a user-visible reply. The outer Events.InteractionCreate
            // handler only logs; without this catch the user sees an
            // indefinite "thinking…" or a silent failure. Surface the
            // traceId so support tickets correlate to logs.
            logError(this.logger, this.clientId, interaction.guildId, err);
            if (interaction.isRepliable()) {
                const content =
                    translator.t('errors:unexpected', { traceId }) ??
                    `Internal error (traceId=${traceId}).`;
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({
                            content,
                            flags: MessageFlags.Ephemeral,
                        });
                    } else {
                        await interaction.reply({
                            content,
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                } catch (replyErr) {
                    // Expired interaction or already-acked race; nothing
                    // else we can do. Already logged the root cause above.
                    logSystem(this.logger, this.clientId, ops.router.replySkipped(String(replyErr)));
                }
            }
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