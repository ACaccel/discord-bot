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
 */
import type { Channel, Role } from 'discord.js';
import type { Connection, Model } from 'mongoose';

import type { Repos } from '../persistence/repositories';

/**
 * Transitional handle exposing the per-guild Mongoose connection +
 * raw model map. Required by Phase 4b-3's `MessageBackupPlugin`,
 * which still uses bulk-insert / count-documents / upsert operations
 * not modelled on the typed `Repos` interfaces. Future phases either
 * extend `Repos` with the missing primitives or retire this field.
 */
export interface GuildDbHandle {
  readonly connection: Connection;
  readonly models: Record<string, Model<unknown>>;
}

export interface GuildRegistry {
  /** Repos bag for `guildId`, or `undefined` when the guild has no DB hookup yet. */
  getRepos(guildId: string): Repos | undefined;
  /**
   * Raw Mongoose handle for `guildId`. Prefer {@link getRepos} for new
   * code; this exists only as a transitional escape hatch for plugins
   * whose legacy logic predates the typed Repo layer.
   *
   * TODO(phase-7): retire this method once `MessageBackupPlugin`
   * (the sole consumer today) is rewritten on top of typed Repos.
   * Removing the method must not survive past Phase 7 — the field
   * exists solely so PR 3 can land verbatim-behaviour without
   * blocking on a deeper persistence-layer refactor.
   */
  getDb(guildId: string): GuildDbHandle | undefined;
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
