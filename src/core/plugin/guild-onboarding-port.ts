/**
 * Guild-onboarding port (D1).
 *
 * When a bot is added to a new Discord guild, two infrastructure
 * actions must happen before the guild is usable: its per-guild Mongo
 * database must be connected, and the bot's slash commands must be
 * registered against that guild. Historically the legacy
 * `src/events/guild_event.ts` handler did this by reaching directly
 * into `BaseBot.connectOneGuild` and `BaseBot.commandHandlers` — a
 * structural coupling the plugin layer was not allowed to depend on.
 *
 * This port is the typed seam that removes that coupling. The
 * composition root (C11 `BaseBot`) provides the concrete
 * implementation and registers it under {@link TOKENS.GuildOnboardingPort};
 * the `guild-events` plugin resolves it via `ctx.resolve` and invokes
 * it from its `guildCreate` subscription. No plugin code ever touches
 * `BaseBot` internals again.
 *
 * Design constraint: this contract uses only primitive / string types,
 * so `core/plugin` does not gain a dependency on `persistence` or
 * `infra` (layer rule §1).
 */

/** Outcome of onboarding a single new guild. */
export interface GuildOnboardingResult {
  /** The guild that was onboarded. */
  readonly guildId: string;
  /** True when the per-guild database connection succeeded. */
  readonly databaseConnected: boolean;
  /** True when slash commands were registered for the guild. */
  readonly commandsRegistered: boolean;
}

/**
 * Typed port encapsulating the two capabilities a new guild needs:
 * connecting its database and registering its commands.
 *
 * Implementations must be safe to call exactly once per `guildCreate`
 * event. They own their own error handling for the command-registration
 * leg (a Discord API hiccup there must not abort onboarding); a failed
 * database connection, however, is surfaced to the caller because the
 * guild cannot function without it.
 */
export interface GuildOnboardingPort {
  /**
   * Connect the new guild's per-guild database and register the bot's
   * slash commands for it.
   *
   * @param guildId - the Discord snowflake of the newly joined guild.
   * @returns a {@link GuildOnboardingResult} describing what succeeded.
   * @throws when the per-guild database connection cannot be
   *   established — the guild is unusable without it.
   */
  onboardGuild(guildId: string): Promise<GuildOnboardingResult>;
}
