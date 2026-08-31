/**
 * GuildRegistry — typed, read-only view of per-guild runtime state that
 * plugins query without holding a reference to BaseBot itself.
 *
 * Lives beside {@link TOKENS} in the composition root: the contract
 * names both a `discord.js` type and the persistence layer's `Repos`
 * bundle, so `core/` — which depends on nothing outside itself — is
 * not its home. Plugins import this contract and `TOKENS` from
 * `src/bot/`; the `BaseBot` class itself stays off-limits to them
 * (enforced by `no-restricted-imports`).
 *
 * Why this exists:
 *   - Plugins must reach repos and configured channels by guild id,
 *     but the IoC container only exposes a typed resolver — not the
 *     BaseBot instance — to prevent service-locator anti-patterns.
 *   - A registry implementation backed by `BaseBot.guildInfo` keeps the
 *     plugin surface narrow (`getRepos`, `getChannel`, `getRole`,
 *     `listGuildIds`) and lets composition roots swap in a different
 *     backing store without touching plugins.
 *
 * The registry is intentionally read-only at the interface level; the
 * BaseBot mutates the underlying map and the registry just reads it.
 * Plugins MUST NOT cast to the concrete impl to mutate state.
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
