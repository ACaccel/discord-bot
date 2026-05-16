/**
 * GuildRegistry — typed, read-only view of per-guild runtime state that
 * plugins query without holding a reference to BaseBot itself.
 *
 * Why this exists (plan §1.1):
 *   - Plugins must reach repos and configured channels by guild id,
 *     but the IoC container only exposes a typed resolver — not the
 *     BaseBot instance — to prevent service-locator anti-patterns.
 *   - A registry implementation backed by `BaseBot.guildInfo` keeps the
 *     plugin surface narrow (`getRepos`, `getChannel`, `getRole`,
 *     `listGuildIds`) and lets future composition roots swap in a
 *     different backing store without touching plugins.
 *
 * The registry is intentionally read-only at the interface level; the
 * BaseBot mutates the underlying map and the registry just reads it.
 * Plugins MUST NOT cast to the concrete impl to mutate state.
 *
 * Audit C-2 retired the `getDb()` transitional escape hatch and the
 * `GuildDbHandle` type alongside it — `MessageBackupPlugin` migrated
 * to typed `Repos` in PR-E, so the raw-Mongoose path no longer has
 * any production consumer.
 */
import type { Channel, Role } from 'discord.js';

import type { Repos } from '../persistence/repositories';

export interface GuildRegistry {
  /** Repos bag for `guildId`, or `undefined` when the guild has no DB hookup yet. */
  getRepos(guildId: string): Repos | undefined;
  /**
   * Configured channel by symbolic name (e.g. `'event'`, `'debug'`,
   * `'earthquake'`). Returns `undefined` when the guild config omits
   * the slot or the channel id no longer resolves to a cached channel.
   */
  getChannel(guildId: string, name: string): Channel | undefined;
  /** Configured role by symbolic name. Same semantics as `getChannel`. */
  getRole(guildId: string, name: string): Role | undefined;
  /** Snapshot of currently-known guild ids. */
  listGuildIds(): readonly string[];
}
