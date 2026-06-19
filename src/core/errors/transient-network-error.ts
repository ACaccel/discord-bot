/**
 * Classifier for transient, retryable network failures that surface as
 * raw `Error`s (not yet wrapped in a `DomainError`).
 *
 * The process-level `uncaughtException` safety net uses this to decide
 * whether an escaped error is a momentary connectivity blip — where the
 * correct response is to log and keep running while the owning client
 * reconnects — versus a genuine fault that must trigger graceful
 * shutdown. The whitelist is intentionally narrow: only well-known OS
 * socket error codes plus Node's "socket hang up" message qualify, so a
 * real programming defect still crashes loudly instead of being masked.
 */

/**
 * OS-level socket error codes treated as transient. A connection blip
 * carrying one of these does not corrupt process state — the owning
 * client (e.g. discord.js's gateway) recovers on its own.
 */
const TRANSIENT_NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET', // peer reset an established connection
  'ETIMEDOUT', // connection or socket timed out
  'EPIPE', // wrote to a socket the peer had already closed
  'ECONNREFUSED', // peer refused the connection
  'ECONNABORTED', // connection aborted locally mid-flight
  'ENOTFOUND', // DNS lookup failed (transient resolver/outage)
  'EAI_AGAIN', // DNS lookup temporarily failed / timed out
  'EHOSTUNREACH', // no route to host
  'ENETUNREACH', // network unreachable
]);

/**
 * Node throws this message (with no `code`) from the legacy HTTP client
 * when a socket ends before the response completes — the exact signature
 * behind the ECONNRESET gateway crash this guard exists to absorb.
 */
const SOCKET_HANG_UP_MESSAGE = 'socket hang up';

/**
 * True when `value` looks like a transient, retryable network failure.
 *
 * Accepts `unknown` because process-level handlers receive errors with
 * no compile-time type. Matches an optional string `code` against the
 * known-transient whitelist, then falls back to Node's "socket hang up"
 * message (which carries no `code`). Non-`Error` values are never
 * transient.
 */
export const isTransientNetworkError = (value: unknown): boolean => {
  if (!(value instanceof Error)) return false;
  const code = (value as { readonly code?: unknown }).code;
  if (typeof code === 'string' && TRANSIENT_NETWORK_ERROR_CODES.has(code)) {
    return true;
  }
  return value.message.toLowerCase().includes(SOCKET_HANG_UP_MESSAGE);
};
