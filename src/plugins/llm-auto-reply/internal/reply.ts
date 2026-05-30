/**
 * Outgoing-reply helpers for the LLM auto-reply plugin.
 *
 * Discord rejects a message whose content exceeds 2000 characters, so an
 * unbounded LLM reply would make `channel.send` throw and the reply would
 * silently fail. Per the single-message design (the reply is one message,
 * never split), an over-long reply is truncated with a trailing ellipsis
 * rather than chunked.
 */

/** Discord's per-message content limit (non-nitro). */
export const MAX_DISCORD_MESSAGE_LENGTH = 2000;
/** Appended when a reply is truncated, to signal the cut. */
const TRUNCATION_SUFFIX = '…';

/**
 * Clamp a reply to Discord's per-message limit. Returns the text unchanged
 * when it already fits; otherwise truncates to exactly the limit including
 * the trailing ellipsis.
 */
export const clampReply = (text: string): string =>
  text.length <= MAX_DISCORD_MESSAGE_LENGTH
    ? text
    : text.slice(0, MAX_DISCORD_MESSAGE_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
