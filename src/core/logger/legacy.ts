/**
 * Handler-facing structured-log helpers — the canonical facade over the
 * typed {@link Logger} for handler / plugin / event callsites that log
 * with the positional `(clientId, guildId, err)` shape.
 *
 * The shape exists because:
 *   - handler callsites do not carry a constructor-injected logger
 *   - the bot scope (`{ bot: clientId }`) + guild scope (`{ guildId }`)
 *     bindings are the same on every line, so pre-composing them at the
 *     helper keeps callsites short
 *   - all output is pino JSON; ops dashboards consume the stream directly
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

/** Bot-scoped info-level log for operator-facing system messages. */
export const logSystem = (logger: Logger | undefined, clientId: string, msg: string): void => {
  logger?.child({ bot: clientId }).info({ msg }, 'system');
};

/**
 * Audit-log-style line tagged with the guild's display name.
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
