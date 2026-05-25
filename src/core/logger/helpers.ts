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
 *
 * History: previously named `legacy.ts` during the pino migration.
 * Renamed because these helpers are the canonical handler-side logging
 * entry points, not legacy code.
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

/**
 * Bot-scoped info-level log for operator-facing system messages.
 *
 * `msg` is passed as the pino headline argument (not in a binding
 * object). The prior shape — `info({ msg }, 'system')` — collided with
 * pino's `messageKey` default (`'msg'`), so the binding silently
 * overrode the literal headline and the pretty output lost the
 * operator-supplied text. Passing `msg` positionally avoids the
 * collision and keeps the headline visible in both pretty and JSON
 * sinks.
 */
export const logSystem = (logger: Logger | undefined, clientId: string, msg: string): void => {
  logger?.child({ bot: clientId }).info(msg);
};

/**
 * Audit-log-style line tagged with the guild's display name.
 *
 * `details` carries the event-specific structured fields (command,
 * user, channel, oldMessage / newMessage, etc.). It is splatted onto
 * the pino record so file consumers (`jq`, log search) can filter on
 * the exact field; the headline is the upper-cased `eventType` so
 * pretty consoles read like `MESSAGE_UPDATE`. Newlines inside any
 * string field are preserved verbatim — JSON.stringify escapes them
 * in the file sink, and pretty rendering shows them on one line per
 * field via the multi-line formatter.
 */
export const logGuildEvent = (
  logger: Logger | undefined,
  clientId: string,
  guildId: string,
  eventType: string,
  details: Readonly<Record<string, unknown>>,
  guildName: string,
): void => {
  const headline = eventType.toUpperCase();
  logger
    ?.child({ bot: clientId, guildId, guildName })
    .info({ eventType: headline, ...details }, headline);
};
