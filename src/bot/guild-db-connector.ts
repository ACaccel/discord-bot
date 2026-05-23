/**
 * Owns per-guild MongoDB connection lifecycle on behalf of BaseBot.
 *
 * Single responsibility: orchestrate the per-guild fan-out that opens
 * each guild's connection through {@link ReposFactory} and surfaces the
 * shared {@link ConnectionManager}'s `traceId` on the boot log so
 * support can correlate the user-facing `errors:db.guild_disabled`
 * message back to the structured log line.
 *
 * The shared {@link ConnectionManager} (resolved via the IoC container)
 * still owns the actual classification + disabling logic; this class
 * is a thin orchestration layer. It is one of the three R1
 * collaborators BaseBot composes; it is intentionally NOT registered
 * as an IoC token (no plugin needs to reach it).
 */
import {
    TOKENS,
    type ReposFactory,
    type ServiceContainer,
} from '../core/ioc';
import { asGuildId } from '../core/ids';
import { logSystem, ops, type Logger } from '../core/logger';
import type {
    ConnectionManager,
    DisabledGuildState,
} from '../infra/mongo/connection-manager';

import type { GuildInfo } from './index';

export class GuildDbConnector {
    /**
     * @param container - the bot's IoC container; resolved per call so
     *   a future hot-swap of `TOKENS.ReposFactory` is observable.
     * @param mongoURI - the bot's Mongo base URI; `undefined` or empty
     *   means the bot was built without a database — `connectAll`
     *   short-circuits, mirroring the prior BaseBot behaviour.
     * @param clientId - the bot's client snowflake; carried on every
     *   log line so multi-bot processes stay grep-able by bot.
     * @param logger - structured logger for ops visibility.
     */
    public constructor(
        private readonly container: ServiceContainer,
        private readonly mongoURI: string | undefined,
        private readonly clientId: string,
        private readonly logger: Logger,
    ) {}

    /**
     * Fan-out connect for every guild slot in `guildInfo`. Per-slot
     * failures are caught and logged through {@link connectOne}; a
     * single bad guild MUST NOT abort the whole startup — the
     * ConnectionManager's disabled-set is the durable record.
     */
    public async connectAll(guildInfo: Record<string, GuildInfo>): Promise<void> {
        logSystem(this.logger, this.clientId, ops.guildDb.poolStart());
        if (this.mongoURI === undefined || this.mongoURI.length === 0) {
            logSystem(this.logger, this.clientId, ops.guildDb.uriMissing());
            return;
        }
        // Promise.all with per-slot try/catch (rather than allSettled +
        // post-hoc inspection) preserves the prior BaseBot ordering:
        // per-guild success log line interleaves with per-guild
        // connect output, which ops grep against.
        await Promise.all(
            Object.entries(guildInfo).map(async ([guildId, slot]) => {
                try {
                    await this.connectOne(guildId, slot);
                    logSystem(
                        this.logger,
                        this.clientId,
                        ops.guildDb.connectSuccess(guildId, slot.guild.name),
                    );
                } catch {
                    // connectOne already logged with the manager's
                    // traceId; swallow here so fan-out continues — the
                    // disabled set in the manager is the durable record
                    // handlers read through `bot.connectionManager.isDisabled`.
                }
            }),
        );
    }

    /**
     * Connect (or reuse) ONE guild's repos bag. Mutates only
     * `slot.repos` and only after the factory resolves successfully —
     * a partial connect cannot leave a half-baked slot visible to
     * handlers.
     *
     * Re-throws the normalised `Error` after logging so callers
     * (`connectAll`'s wrapper, the `GuildOnboardingPort`) keep the
     * prior control-flow semantics.
     */
    public async connectOne(guildId: string, slot: GuildInfo): Promise<void> {
        const branded = asGuildId(guildId);
        try {
            const reposFactory = this.container.resolve<ReposFactory>(TOKENS.ReposFactory);
            const repos = await reposFactory(branded);
            // Single mutation — atomic from the handlers' perspective.
            slot.repos = repos;
        } catch (err) {
            const normalised =
                err instanceof Error
                    ? err
                    : new Error(typeof err === 'string' ? err : 'connectOne failed');
            const cm = this.container.tryResolve<ConnectionManager>(TOKENS.ConnectionManager);
            const traceId = cm?.isDisabled(branded)?.traceId ?? 'unknown';
            logSystem(
                this.logger,
                this.clientId,
                ops.guildDb.connectFailed(guildId, traceId, normalised.message),
            );
            throw normalised;
        }
    }

    /**
     * Pass-through to {@link ConnectionManager.isDisabled}. Returns
     * `undefined` when the bot was built without a Mongo URI (and
     * therefore has no `ConnectionManager` registered).
     */
    public isDisabled(guildId: string): DisabledGuildState | undefined {
        const cm = this.container.tryResolve<ConnectionManager>(TOKENS.ConnectionManager);
        return cm?.isDisabled(asGuildId(guildId));
    }
}
