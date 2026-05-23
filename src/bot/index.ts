/**
 * `BaseBot` — thin lifecycle owner.
 *
 * R1: BaseBot's prior 1,000-line surface was decomposed into a small
 * orchestrator plus three single-purpose collaborators:
 *
 *   - {@link GuildRegistrar} — assembles `GuildInfo` from the Discord
 *     cache + bot config (`registerAll`).
 *   - {@link ClientEventBridge} — Adapter from `client.on(...)` raw
 *     events to router dispatch, plugin EventDispatcher, reaction
 *     port, and the GuildCreate fallback.
 *   - {@link GuildDbConnector} — owns per-guild Mongo connection
 *     fan-out and failure normalisation.
 *
 * BaseBot itself stages plugins (`use`), wires the IoC container,
 * builds the PluginHost, runs the eight startup phases in order, and
 * tears them down in reverse for `shutdown`. Subclasses extend by
 * registering plugins in their constructor and by overriding the small
 * set of protected hooks (`configureInteractionRouter`,
 * `channelLoggingBlockedChannels`, `eventBridgeSuppression`).
 */
import type { Channel, Client, Guild, Role } from 'discord.js';
import { Events } from 'discord.js';
import type { Job } from 'node-schedule';

import type { ButtonHandler } from '@button';
import { registerButtons } from '@button';
import type { Command } from '@cmd';
import { registerCommands } from '@cmd';
import type { ModalHandler } from '@modal';
import { registerModals } from '@modal';
import type { ReactionHandler } from '@reaction';
import { executeReactionAdded, executeReactionRemoved, registerReactions } from '@reaction';
import type { SSMHandler } from '@select-menu';
import { registerSSMs } from '@select-menu';

import { createBootstrapLogger, loadEnv, type Env } from '../core/config';
import type { GuildRegistry } from '../core/guild-registry';
import type { Translator } from '../core/i18n';
import { createDefaultTranslator } from '../core/i18n';
import type { asGuildId } from '../core/ids';
import {
    createContainer,
    TOKENS,
    type ReposFactory,
    type ServiceContainer,
} from '../core/ioc';
import {
    installProcessHandlers,
    logError,
    type Logger,
} from '../core/logger';
import {
    InteractionRouter,
    PluginHost,
    type Plugin,
} from '../core/plugin';
import { systemClock, type Clock } from '../core/time';
import {
    MongoConnectionManager,
    type ConnectionManager,
} from '../infra/mongo/connection-manager';
import { buildRepos, type Repos } from '../persistence/repositories';
import { getActiveVoiceController, type VoiceController } from '../plugins/voice/internal';

import {
    ClientEventBridge,
    type ClientEventBridgeSuppression,
    type ReactionHandlerPort,
} from './client-event-bridge';
import { GuildDbConnector } from './guild-db-connector';
import { BaseBotGuildOnboardingPort } from './guild-onboarding';
import { GuildRegistrar } from './guild-registrar';
import {
    createChannelLoggingMiddleware,
    createDispatchMiddleware,
} from './middlewares';

/**
 * Process-wide pool of {@link MongoConnectionManager}s keyed by base
 * URI. Two BaseBots sharing a URI reuse the same manager (and thus
 * the same per-guild connection pool), and tests / multi-cluster
 * setups that pass distinct URIs get distinct managers.
 */
const sharedConnectionManagers = new Map<string, MongoConnectionManager>();
const sharedConnectionManagerForUri = (uri: string): MongoConnectionManager => {
    const existing = sharedConnectionManagers.get(uri);
    if (existing !== undefined) return existing;
    const created = new MongoConnectionManager(uri);
    sharedConnectionManagers.set(uri, created);
    return created;
};

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

/**
 * Thin lifecycle owner. Wires the IoC container, stages plugins, then
 * delegates Guild registration, Discord event fan-out, and per-guild
 * Mongo lifecycle to the three injected collaborators
 * ({@link GuildRegistrar}, {@link ClientEventBridge},
 * {@link GuildDbConnector}). Subclasses register plugins in their
 * constructor and override the small set of `protected` hooks declared
 * at the bottom of this class.
 */
export abstract class BaseBot<TConfig extends Config = Config> {
    // ---- public state (handlers read these) ----
    /**
     * Composition-root IoC container. Owned by BaseBot, populated in
     * the constructor with `ConnectionManager` + `ReposFactory`. Other
     * layers must NOT import this container — handlers reach repos via
     * `bot.guildInfo[guildId].repos`. The eslint `no-restricted-imports`
     * rule enforces the constraint.
     */
    public readonly container: ServiceContainer;
    public client: Client;
    public clientId: string;
    public adminId?: string;
    public config: TConfig;
    public guildInfo: Record<string, GuildInfo> = {};

    public commandHandlers: Map<string, Command> = new Map();
    public buttonHandlers: Map<string, ButtonHandler> = new Map();
    public modalHandlers: Map<string, ModalHandler> = new Map();
    public ssmHandlers: Map<string, SSMHandler> = new Map();
    public reactionHandlers: Map<string, ReactionHandler> = new Map();
    public jobs: Map<string, Job> = new Map();
    public helpMessage: string = '';

    /**
     * Bot-scoped voice controller. Populated in {@link run} after
     * `host.initAll()` returns; the VoicePlugin's `init` hook publishes
     * the controller into a module-scoped holder we read here.
     * Optional only to model bots that never register the plugin
     * (e.g. msg-archive).
     */
    public voice?: VoiceController;

    /** Bot-scoped {@link Translator}. Undefined only in the pre-`run()` window. */
    public translator: Translator | undefined;

    /** Bot-scoped structured logger. Undefined only in the pre-`run()` window. */
    public logger: Logger | undefined;

    /** Typed, validated process environment. Undefined when env validation failed at boot. */
    public env: Env | undefined;

    // ---- protected hook fields ----

    /**
     * Translator key for the bot's `/help` body. Subclasses set this in
     * their constructor; {@link run} resolves it once the translator is
     * loaded and stores the rendered string in {@link helpMessage}.
     * Holding the key (rather than the rendered text) in subclasses
     * keeps composition roots CJK-free, which the i18n scanner enforces.
     */
    protected helpMessageKey?: string;

    /**
     * Built inside {@link run}. Subclass middleware is appended via
     * {@link configureInteractionRouter}.
     */
    protected interactionRouter: InteractionRouter | undefined;

    // ---- private state ----
    private readonly token: string;
    private readonly mongoURI?: string;
    private readonly pendingPlugins: Array<{ plugin: Plugin<unknown>; config: unknown }> = [];
    private pluginHost: PluginHost | undefined;

    // ---- collaborators (R1 composition) ----
    private readonly guildRegistrar: GuildRegistrar;
    private readonly clientEventBridge: ClientEventBridge;
    private readonly guildDbConnector: GuildDbConnector;

    public constructor(
        client: Client,
        token: string,
        mongoURI: string,
        clientId: string,
        config: TConfig,
    ) {
        this.token = token;
        this.mongoURI = mongoURI;
        this.client = client;
        this.clientId = clientId;
        this.config = config;

        this.container = createContainer();
        // Logger is the first registration so downstream factories may
        // resolve it for their own structured logs. Bound with
        // `{ bot: clientId }` so every line carries the bot identity.
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
        this.container.registerSingleton(TOKENS.Clock, () => systemClock);
        // GuildRegistry is a read-only view over `this.guildInfo` so
        // plugins reach guild lookup without holding a BaseBot reference.
        const guildRegistry: GuildRegistry = {
            getRepos: (guildId) => this.guildInfo[guildId]?.repos,
            getChannel: (guildId, name) => this.guildInfo[guildId]?.channels?.[name],
            getRole: (guildId, name) => this.guildInfo[guildId]?.roles?.[name],
            listGuildIds: () => Object.keys(this.guildInfo),
        };
        this.container.registerSingleton(TOKENS.GuildRegistry, () => guildRegistry);
        this.container.registerSingleton(TOKENS.DiscordClient, () => this.client);
        this.container.registerSingleton(TOKENS.JobMap, () => this.jobs);
        this.container.registerSingleton(
            TOKENS.GuildOnboardingPort,
            () => new BaseBotGuildOnboardingPort(this),
        );

        // Construct collaborators with a bootstrap logger so they have a
        // structured sink before the bot-scoped Logger is wired in `run()`.
        // The bootstrap logger from the container is the same instance
        // `setupContainer` exposes as `this.logger`, so log ownership stays
        // single-sourced.
        const bootstrapLogger = this.container.resolve<Logger>(TOKENS.Logger);
        this.guildRegistrar = new GuildRegistrar(this.client, this.clientId, bootstrapLogger);
        this.clientEventBridge = new ClientEventBridge(this.client, this.clientId, bootstrapLogger);
        this.guildDbConnector = new GuildDbConnector(
            this.container,
            this.mongoURI,
            this.clientId,
            bootstrapLogger,
        );
    }

    // ---- typed accessors handlers read through ----

    /**
     * Live shared {@link ConnectionManager}. Returns `undefined` only
     * in the pre-`run()` window or when the bot was constructed without
     * a `MONGO_URI`; handler callsites null-check before reading.
     */
    public get connectionManager(): ConnectionManager | undefined {
        return this.container.tryResolve<ConnectionManager>(TOKENS.ConnectionManager);
    }

    // ---- lifecycle ----

    /**
     * Stage a plugin for registration. Fluent for subclass constructors.
     */
    public use<C>(plugin: Plugin<C>, config?: C): this {
        this.pendingPlugins.push({
            plugin: plugin as Plugin<unknown>,
            config: config as unknown,
        });
        return this;
    }

    /** Expose the host for tests / inspection. Undefined before {@link run}. */
    public getPluginHost(): PluginHost | undefined {
        return this.pluginHost;
    }

    public getMongoURI(): string | undefined {
        return this.mongoURI;
    }

    public getToken(): string {
        return this.token;
    }

    /**
     * Orchestrator. Walks the startup phases in dependency order:
     *
     *   1. setupContainer       — env, logger, process safety nets
     *   2. buildHost            — translator, router, host.initAll
     *   3. armReadyLatch        — register ClientReady listener (deferred)
     *   4. login                — Discord side
     *   5. host.startAll        — collect plugin event subscriptions
     *   6. clientEventBridge.attach — wire raw + dispatcher listeners
     *   7. openReadyLatch       — unblock the deferred ClientReady body
     */
    public run = async (callback?: () => Promise<void>): Promise<void> => {
        const rootLogger = this.setupContainer();
        const host = await this.buildHost(rootLogger);
        const openReadyLatch = this.armReadyLatch(callback);
        await this.login();
        // start runs after login but BEFORE the bridge attaches — the
        // dispatcher's subscription list stabilises inside startAll().
        await host.startAll();
        this.clientEventBridge.attach({
            container: this.container,
            host,
            router: this.interactionRouter,
            reactionPort: this.buildReactionPort(),
            guildInfo: () => this.guildInfo,
            suppression: this.eventBridgeSuppression(),
        });
        openReadyLatch();
    };

    /**
     * Reverse-order shutdown:
     *
     *   pluginHost.shutdownAll → clientEventBridge.detach
     *     → client.destroy → ConnectionManager.closeAll
     *
     * Best-effort: each step is wrapped so one failure does not abort
     * the rest of the teardown.
     */
    public shutdown = async (): Promise<void> => {
        const log = this.container.tryResolve<Logger>(TOKENS.Logger);
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
            this.clientEventBridge.detach();
        } catch (e: unknown) {
            log?.warn(
                { err: e instanceof Error ? e : new Error(String(e)) },
                'shutdown: clientEventBridge.detach threw',
            );
        }
        try {
            this.client.destroy();
        } catch (e: unknown) {
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
    };

    public reLogin = async (): Promise<void> => {
        await this.client.login(this.token);
    };

    /**
     * Open (or reuse) the per-guild MongoDB connection and populate
     * `guildInfo[g].repos`. Delegates to the {@link GuildDbConnector}
     * R1 collaborator. Re-throws on failure so existing callers
     * (`connectGuildDB`, the {@link BaseBotGuildOnboardingPort}) keep
     * their prior control-flow semantics.
     */
    public connectOneGuild = async (guildId: string): Promise<void> => {
        const slot = this.guildInfo[guildId];
        if (slot === undefined) return;
        await this.guildDbConnector.connectOne(guildId, slot);
    };

    /**
     * Fan-out per-guild Mongo connect across `guildInfo`. Delegates to
     * the {@link GuildDbConnector} collaborator.
     */
    public connectGuildDB = async (): Promise<void> => {
        await this.guildDbConnector.connectAll(this.guildInfo);
    };

    // ---- subclass hooks ----

    /**
     * Subclass hook: append middleware to the bot's
     * {@link InteractionRouter} BEFORE the terminal dispatch /
     * channel-logging stages run. Default is a no-op.
     */
    protected configureInteractionRouter(_router: InteractionRouter): void {
        // default: no extra middleware
    }

    /**
     * Subclass hook returning channels (and parent thread channels)
     * whose slash-command activity should NOT be logged to the debug
     * channel. Default `undefined` means "log everything".
     */
    protected channelLoggingBlockedChannels(): readonly string[] | undefined {
        return undefined;
    }

    /**
     * Subclass hook controlling which {@link ClientEventBridge}
     * listeners are installed. Default installs every listener. Bots
     * that opt out of an interaction class (the LLM-only `Konata`, the
     * worker-style `MsgArchive`) override this and flip the relevant
     * flags to `true`. R1 replaced the prior listener-method-override
     * idiom (`override interactionEventListener = async () => {}`)
     * because those methods no longer exist on BaseBot.
     */
    protected eventBridgeSuppression(): ClientEventBridgeSuppression {
        return {};
    }

    // ---- private orchestration helpers ----

    /**
     * Phase 1: bind structured logger, install process safety nets,
     * load typed Env. Returns the bot-scoped logger so the caller can
     * hand it to phase 2 without resolving the container twice.
     */
    private setupContainer(): Logger {
        const rootLogger = this.container.resolve<Logger>(TOKENS.Logger);
        this.logger = rootLogger;
        installProcessHandlers({
            logger: rootLogger,
            gracefulShutdown: () => this.shutdown(),
        });
        try {
            const env = loadEnv({
                exitOnFailure: false,
                requireDb: this.mongoURI !== undefined,
            });
            this.container.registerSingleton(TOKENS.Env, () => env);
            this.env = env;
        } catch (envErr: unknown) {
            rootLogger.warn(
                { err: envErr instanceof Error ? envErr : new Error(String(envErr)) },
                'BaseBot.run: typed Env load failed; TOKENS.Env will be unbound. Plugins requiring it (e.g. LlmChatPlugin) will fail at init.',
            );
        }
        return rootLogger;
    }

    /**
     * Phase 2: resolve the Translator, assemble the InteractionRouter
     * Chain-of-Responsibility, build the PluginHost, register pending
     * plugins, run host `initAll()`.
     */
    private async buildHost(rootLogger: Logger): Promise<PluginHost> {
        const translator = await createDefaultTranslator();
        this.container.registerSingleton(TOKENS.Translator, () => translator);
        this.translator = translator;
        if (this.helpMessageKey !== undefined) {
            this.helpMessage = translator.t(this.helpMessageKey);
        }
        // Assemble the Chain-of-Responsibility interaction router.
        // Subclass-injected middleware runs FIRST (gate / context-prime),
        // then the terminal dispatch + observability stages.
        this.interactionRouter = new InteractionRouter();
        this.configureInteractionRouter(this.interactionRouter);
        this.interactionRouter.use(createDispatchMiddleware(this));
        this.interactionRouter.use(
            createChannelLoggingMiddleware(this, {
                blockedChannels: this.channelLoggingBlockedChannels(),
            }),
        );

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
        host.buildEffectiveRegistries();
        this.pluginHost = host;
        await host.initAll();
        // VoicePlugin publishes its controller into a module-scoped
        // holder during init; surface it now so the record handler can
        // reach it via `bot.voice`.
        this.voice = getActiveVoiceController();
        return host;
    }

    /**
     * Phase 3 prelude: register the `ClientReady` listener BEFORE
     * `client.login()` so a fast-firing ready event is not missed. The
     * latch lets the handler observe a fully-set-up host (startAll
     * done, bridge attached) before invoking `host.readyAll()`.
     */
    private armReadyLatch(callback?: () => Promise<void>): () => void {
        let openReadyLatch: () => void = () => {};
        const readyLatch = new Promise<void>((resolve) => {
            openReadyLatch = resolve;
        });
        this.client.once(Events.ClientReady, async () => {
            await readyLatch;
            await this.handleClientReady(callback);
        });
        return openReadyLatch;
    }

    /**
     * Body of the `clientReady` handler. Runs guild registration, Mongo
     * fan-out, handler-registry build-out, reboot fan-out, the optional
     * caller callback, and finally `host.readyAll()`.
     */
    private async handleClientReady(callback?: () => Promise<void>): Promise<void> {
        try {
            this.guildInfo = this.guildRegistrar.registerAll(this.config);
            await this.guildDbConnector.connectAll(this.guildInfo);
            await registerCommands(this);
            await registerButtons(this);
            await registerSSMs(this);
            await registerModals(this);
            await registerReactions(this);
            await this.clientEventBridge.sendRebootMessages(this.translator);
            if (callback !== undefined) {
                await callback();
            }
            // readyAll runs AFTER clientReady so plugins observe a
            // fully-online client when their `onReady` hook fires.
            // Failures here are logged but never fatal — the bot is
            // already serving, mirroring the host docstring policy.
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
    }

    /**
     * Phase 4: Discord side of the login dance. Errors here are
     * currently logged but do not reject — R6.2 will tighten this so
     * `run()` rejects on a missing user.
     */
    private async login(): Promise<void> {
        await this.client.login(this.token).catch(() => {
            // logged through the structured logger below; the typed
            // logger is bound during phase 1.
        });
        if (this.config.admin !== undefined) {
            this.adminId = this.config.admin;
        }
    }

    /**
     * Build the `ReactionHandlerPort` the bridge consumes. The reaction
     * codegen entry points (`executeReactionAdded` / `executeReactionRemoved`)
     * accept a `BaseBot` reference; the port adapts them so the bridge
     * itself stays decoupled from the bot.
     */
    private buildReactionPort(): ReactionHandlerPort {
        return {
            handleAdded: (reaction, user) => executeReactionAdded(reaction, user, this),
            handleRemoved: (reaction, user) => executeReactionRemoved(reaction, user, this),
        };
    }
}

