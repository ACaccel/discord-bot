/**
 * Builds `GuildInfo` records for a bot from the live Discord cache +
 * the bot's static config.
 *
 * Single responsibility: pure assembly. The registrar does not open
 * Mongo connections, does not perform Discord I/O beyond reading the
 * local guild / channel / role caches, and never sends a message. It
 * is one of the three collaborators BaseBot composes.
 *
 * Pattern: this is a domain Builder / Assembler — it takes the wide
 * raw cache surface and reduces it to the narrow `GuildInfo` value the
 * handler layer reads. Encapsulating the assembly here keeps BaseBot
 * thin and lets the build rules evolve (missing-channel handling,
 * partial config tolerance) without touching lifecycle code.
 */
import type { Channel, Client, Guild, Role } from 'discord.js';

import { logSystem, type Logger } from '../core/logger';

import type { Config, GuildInfo } from './index';

export class GuildRegistrar {
    /**
     * @param client - the bot's Discord client; only the local guild /
     *   channel / role caches are read.
     * @param clientId - the bot's client snowflake; used to look up the
     *   bot's own member entry so `GuildInfo.bot_name` can carry the
     *   per-guild display name.
     * @param logger - structured logger; one info line per guild is
     *   written during {@link registerAll} for ops visibility.
     */
    public constructor(
        private readonly client: Client,
        private readonly clientId: string,
        private readonly logger: Logger,
    ) {}

    /**
     * Build a `GuildInfo` for a single guild from the live cache and
     * the bot's static config. Best-effort: channel / role ids present
     * in `config` but missing from the live cache are silently omitted
     * from the returned record; handler code null-checks downstream.
     *
     * Does NOT throw — a malformed config or a missing cache entry
     * degrades the returned `GuildInfo` rather than aborting startup.
     */
    public register(guild: Guild, config: Config): GuildInfo {
        const guildConfig = config.guilds?.[guild.id];
        const channels = this.resolveChannels(guildConfig?.channels);
        const roles = this.resolveRoles(guild, guildConfig?.roles);
        return {
            bot_name: guild.members.cache.get(this.clientId)?.displayName ?? '',
            guild,
            channels,
            roles,
        };
    }

    /**
     * Iterate `client.guilds.cache` and produce the full keyed map.
     * Per-guild failures are logged but do not abort the fan-out — one
     * malformed config entry must not prevent other guilds from
     * registering.
     */
    public registerAll(config: Config): Record<string, GuildInfo> {
        logSystem(this.logger, 'Registering guilds...');
        const result: Record<string, GuildInfo> = {};
        let index = 0;
        for (const guild of this.client.guilds.cache.values()) {
            try {
                result[guild.id] = this.register(guild, config);
                index += 1;
                logSystem(this.logger, `${index}. ${guild.id} - ${guild.name}`);
            } catch (err) {
                logSystem(this.logger, `Cannot register guild ${guild.id}: ${String(err)}`);
            }
        }
        logSystem(this.logger, 'Successfully registered all guilds.');
        return result;
    }

    /**
     * Translate a `name → channelId` config map into a `name → Channel`
     * map by reading the client's channel cache. Missing ids drop out
     * of the result.
     */
    private resolveChannels(
        channelMap: Record<string, string> | undefined,
    ): Record<string, Channel> {
        const out: Record<string, Channel> = {};
        if (channelMap === undefined) return out;
        for (const [name, id] of Object.entries(channelMap)) {
            const channel = this.client.channels.cache.get(id);
            if (channel !== undefined) {
                out[name] = channel;
            }
        }
        return out;
    }

    /**
     * Translate a `name → roleId` config map into a `name → Role` map
     * by reading the guild's role cache. Missing ids drop out of the
     * result (the prior implementation stored `undefined` casts, which
     * surfaced as runtime crashes when handlers dereferenced them — the
     * new behaviour is strictly safer).
     */
    private resolveRoles(
        guild: Guild,
        roleMap: Record<string, string> | undefined,
    ): Record<string, Role> {
        const out: Record<string, Role> = {};
        if (roleMap === undefined) return out;
        for (const [name, id] of Object.entries(roleMap)) {
            const role = guild.roles.cache.get(id);
            if (role !== undefined) {
                out[name] = role;
            }
        }
        return out;
    }
}
