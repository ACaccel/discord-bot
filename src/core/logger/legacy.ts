/**
 * Handler-facing structured-log helpers — the post-PR-F2 home for the
 * positional-args `(clientId, guildId, err)` shape that handler / plugin
 * / event callsites grew up calling. Replaces the deprecated
 * `src/utils/logger.ts` shim (PR-E retired the file-backup leg; PR-F2
 * collapses everything into pure `core/logger` `child().error()` /
 * `child().info()` lines).
 *
 * These functions are **not** deprecated — they are the canonical
 * handler-side facade over the typed {@link Logger}. The shape exists
 * because:
 *   - handler callsites pre-date constructor-injected loggers
 *   - the bot scope (`{ bot: clientId }`) + guild scope (`{ guildId }`)
 *     bindings are the same on every line, so pre-composing them at the
 *     helper keeps callsites short
 *   - the legacy file backup (`./logs/<bot>/...`) is gone — ops dashboards
 *     consume the pino JSON stream directly
 *
 * Layer purity: this module deliberately depends only on the
 * {@link Logger} interface. Helpers that touch discord.js / axios / fs
 * (Discord-channel mirror, attachment archival) live under
 * `src/infra/discord/` so `core/**` stays free of third-party SDK
 * imports per the architecture contract.
 */
import type { Logger } from './logger';

/**
 * Log an unexpected error. `err` may be a DomainError instance, a native
 * Error, or any thrown value — pino's serialiser preserves stack + cause
 * for Error subclasses; non-Error throws are emitted under the `raw` key.
 *
 * `logger === undefined` is a defensive no-op for the pre-`run()` window;
 * any handler-context callsite is guaranteed to receive a defined logger.
 */
export const logError = (
  logger: Logger | undefined,
  clientId: string,
  guildId: string | null | undefined,
  err: unknown,
): void => {
  if (logger === undefined) return;
  const child =
    guildId === null || guildId === undefined || guildId === ''
      ? logger.child({ bot: clientId })
      : logger.child({ bot: clientId, guildId });
  if (err instanceof Error) {
    child.error({ err }, 'errorLogger');
  } else {
    child.error({ raw: err }, 'errorLogger');
  }
};

/** Bot-scoped info-level log; the legacy `systemLogger` shape. */
export const logSystem = (logger: Logger | undefined, clientId: string, msg: string): void => {
  logger?.child({ bot: clientId }).info({ msg }, 'system');
};

/**
 * Audit-log-style line tagged with the guild's display name. Drops the
 * pre-PR-F2 file backup (deprecated since Phase 6 per the shim header).
 */
export const logGuildEvent = (
  logger: Logger | undefined,
  clientId: string,
  guildId: string,
  eventType: string,
  msg: string,
  guildName: string,
): void => {
  const flat = msg.replaceAll('\n', '\\n');
  logger
    ?.child({ bot: clientId, guildId, guildName })
    .info({ eventType: eventType.toUpperCase(), msg: flat }, 'guild event');
};
