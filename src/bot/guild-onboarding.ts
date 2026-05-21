/**
 * Guild-onboarding port implementation (gap D1, C11 slice).
 *
 * The `GuildOnboardingPort` contract is defined in
 * `core/plugin/guild-onboarding-port.ts`. This module supplies the
 * concrete, `BaseBot`-backed implementation and lives in `src/bot/`
 * because the composition root is the only layer permitted to depend
 * on `BaseBot` internals (`connectOneGuild`, `commandHandlers`,
 * `guildInfo`).
 *
 * Before D1, a newly joined guild was onboarded by the legacy
 * `src/events/guild_event.ts` handler reaching directly into those
 * internals. The port collapses that coupling into a single typed
 * seam: `BaseBot` registers an instance under
 * `TOKENS.GuildOnboardingPort`, and the `guild-events` plugin (C8 D1,
 * a later wave) resolves and invokes it from its `guildCreate`
 * subscription. No plugin code touches `BaseBot` again.
 *
 * Pattern: Adapter — adapts the wide `BaseBot` surface to the narrow
 * `GuildOnboardingPort` interface so consumers depend only on the
 * port.
 */
import type { Guild } from 'discord.js';

import type {
    GuildOnboardingPort,
    GuildOnboardingResult,
} from '../core/plugin/guild-onboarding-port';
import { logSystem, ops } from '../core/logger';
import { getCommandJsonBody } from '@cmd';

import type { BaseBot, GuildInfo } from './index';

/**
 * `BaseBot`-backed {@link GuildOnboardingPort}.
 *
 * The implementation is intentionally a thin Adapter over `BaseBot`:
 * it owns no state of its own and reads everything it needs from the
 * bot at call time, so it stays correct across the bot's whole
 * lifecycle (e.g. `commandHandlers` populated only after
 * `registerCommands` runs during `clientReady`).
 */
export class BaseBotGuildOnboardingPort implements GuildOnboardingPort {
    /**
     * @param bot - the composition-root bot whose internals the port
     *   adapts. Held by reference so the port observes the bot's live
     *   `guildInfo` / `commandHandlers` state.
     */
    public constructor(private readonly bot: BaseBot) {}

    /**
     * Onboard a freshly joined guild: initialise its `guildInfo` slot,
     * open its per-guild database connection, and register the bot's
     * slash commands for it.
     *
     * A failed database connection is re-thrown — the guild cannot
     * function without it. A failed command registration is caught and
     * logged: a Discord API hiccup there must not abort onboarding (the
     * commands re-sync on the next deploy / restart).
     *
     * @param guildId - the Discord snowflake of the newly joined guild.
     * @returns a {@link GuildOnboardingResult} describing what succeeded.
     * @throws when the per-guild database connection cannot be opened.
     */
    public async onboardGuild(guildId: string): Promise<GuildOnboardingResult> {
        const bot = this.bot;
        const guild = bot.client.guilds.cache.get(guildId);
        if (guild === undefined) {
            // A `guildCreate` event always carries a cached guild, so a
            // missing entry here is a contract violation by the caller,
            // not a runtime/domain failure — surface it as TypeError.
            throw new TypeError(
                `BaseBotGuildOnboardingPort.onboardGuild: guild ${guildId} is not in the client cache.`,
            );
        }

        this.initialiseGuildInfoSlot(guild);
        const databaseConnected = await this.connectDatabase(guildId);
        const commandsRegistered = this.registerGuildCommands(guildId);

        logSystem(
            bot.logger,
            bot.clientId,
            `Bot added to guild: ${guild.name} (${guildId})`,
        );
        return { guildId, databaseConnected, commandsRegistered };
    }

    /**
     * Create the bot's `guildInfo` slot for a new guild. Mirrors the
     * shape the legacy `detectGuildCreate` produced: empty channel /
     * role maps, populated `bot_name` from the member cache.
     */
    private initialiseGuildInfoSlot(guild: Guild): void {
        const slot: GuildInfo = {
            bot_name: guild.members.cache.get(this.bot.clientId)?.displayName ?? '',
            guild,
            channels: {},
            roles: {},
        };
        this.bot.guildInfo[guild.id] = slot;
    }

    /**
     * Open the per-guild database connection via `connectOneGuild`.
     * Re-throws on failure: the guild is unusable without its database.
     */
    private async connectDatabase(guildId: string): Promise<boolean> {
        const mongoURI = this.bot.getMongoURI();
        // A bot built without Mongo gets either `undefined` or the
        // empty-string fallback (`env.MONGO_URI ?? ''`) — treat both as
        // "no database configured", a deployment choice rather than a
        // per-guild failure.
        if (mongoURI === undefined || mongoURI.length === 0) {
            return false;
        }
        await this.bot.connectOneGuild(guildId);
        return this.bot.guildInfo[guildId]?.repos !== undefined;
    }

    /**
     * Register the bot's slash commands against the new guild. Failures
     * are caught and logged — a Discord API error here must not abort
     * onboarding.
     */
    private registerGuildCommands(guildId: string): boolean {
        const bot = this.bot;
        const application = bot.client.application;
        if (application === null || application === undefined) {
            logSystem(
                bot.logger,
                bot.clientId,
                'Skipped guild command registration: client application is not ready.',
            );
            return false;
        }
        const restCommands = getCommandJsonBody(bot.commandHandlers, bot);
        // `commands.set` returns a promise; onboarding does not await it
        // (legacy parity) but the rejection must not escape as an
        // unhandledRejection — funnel it into the structured logger.
        application.commands.set(restCommands, guildId).catch((err: unknown) => {
            logSystem(
                bot.logger,
                bot.clientId,
                ops.command.registerFailed(String(err)),
            );
        });
        return true;
    }
}
