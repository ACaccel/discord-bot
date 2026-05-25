/**
 * Centralised operator-facing log message templates.
 *
 * Inline log literals scattered across callsites are hard to grep,
 * cannot carry stable event codes, and quietly drift when the same
 * idea is logged from multiple places. Routing operator-facing lines
 * through this module avoids all three.
 *
 * The constants below live in one file so:
 *   - `grep -rn ops:<event-id>` finds every callsite at once.
 *   - A future migration to structured logging (event codes + JSON
 *     payloads) is mechanical — replace one constant, ripple through
 *     every caller without touching their bodies.
 *   - Reviewers can spot inline log literals as code smell: anything
 *     not routed through this module is implicitly ad-hoc.
 *
 * Discipline: new operator-facing log lines that survive PR review
 * SHOULD land here first. Throwaway debug log lines inside a single
 * function body MAY stay inline. Per-handler error bodies forwarded
 * verbatim from caught exceptions (`logger.errorLogger(..., err)`)
 * do not pass through here — that path takes the `Error` value, not
 * a message string.
 *
 * Format conventions:
 *   - Each event is a `() => string` (or arrow with params) returning
 *     the rendered line. The function form lets the caller pass
 *     contextual values without exposing the underlying template
 *     string to inline mutation.
 *   - Lines start with an `ops:<area>.<event>` prefix so log filtering
 *     by area is a single grep.
 */

export const ops = {
  command: {
    registerStart: (): string => `ops:command.register_start | Registering commands...`,
    registerEmpty: (): string => `ops:command.register_empty | No commands to register.`,
    registerSuccess: (count: number): string =>
      `ops:command.register_success | Successfully registered ${count} application (/) commands.`,
    registerFailed: (detail: string): string =>
      `ops:command.register_failed | Failed to register commands: ${detail}`,
    handlerMissingConfig: (commandName: string): string =>
      `ops:command.handler_missing_config | Command ${commandName} has no config.`,
  },
  guildDb: {
    slotMissing: (guildId: string): string =>
      `ops:guild_db.slot_missing | connectOneGuild: no guildInfo slot for ${guildId}`,
    connectFailed: (guildId: string, traceId: string, detail: string): string =>
      `ops:guild_db.connect_failed | connectOneGuild failed for guild ${guildId} traceId=${traceId}: ${detail}`,
    connectSuccess: (guildId: string, guildName: string): string =>
      `ops:guild_db.connect_success | MongoDB for guild: ${guildId} - ${guildName} connected.`,
    poolStartFailed: (detail: string): string =>
      `ops:guild_db.pool_start_failed | Failed to connect to MongoDB: ${detail}`,
    uriMissing: (): string => `ops:guild_db.uri_missing | No MongoDB URI.`,
    poolStart: (): string => `ops:guild_db.pool_start | Connecting to MongoDB...`,
  },
  router: {
    replySkipped: (code: number | string): string =>
      `ops:router.reply_skipped | discord reply skipped (expired interaction, code=${code}).`,
    /**
     * Correlation marker for a handler-boundary error. The `traceId`
     * matches the id interpolated into the user-facing
     * `replies:<feature>.failed` copy so operators can `grep` from a
     * support ticket back to the structured error line.
     */
    handlerError: (traceId: string): string =>
      `ops:router.handler_error | handler boundary error (traceId=${traceId}).`,
  },
} as const;
