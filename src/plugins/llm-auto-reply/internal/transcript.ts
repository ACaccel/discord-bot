/**
 * Pure transcript helpers for the LLM auto-reply plugin.
 *
 * Kept free of discord.js so the prompt-format contract and the
 * time-window predicate are unit-testable in isolation — the
 * orchestrator maps live `Message` objects down to
 * {@link TranscriptMessage} before calling in.
 */

/** Discord-free projection of a channel message used to build a prompt. */
export interface TranscriptMessage {
  /** Author global display name (`User.displayName` = globalName ?? username); never a guild nickname or tag. */
  readonly displayName: string;
  /** Raw message content. */
  readonly content: string;
  /** Creation time, milliseconds since epoch. */
  readonly createdTimestamp: number;
  /** Whether the author is a bot — bot lines are excluded from the prompt. */
  readonly isBot: boolean;
}

/**
 * Render messages (expected oldest -> newest) into the endpoint's
 * single-string transcript. Each surviving line is
 * `<displayName>: <content>`, joined with `\n`. The channel name is
 * deliberately NOT prefixed: the endpoint receives only the speaker and
 * their words. Bot-authored and blank-content messages are dropped, so
 * the result may be empty when nothing human remains.
 */
export const buildTranscript = (messages: readonly TranscriptMessage[]): string =>
  messages
    .filter((m) => !m.isBot && m.content.trim().length > 0)
    .map((m) => `${m.displayName}: ${m.content.trim()}`)
    .join('\n');

/**
 * True when every timestamp falls inside a single window of `windowMs`,
 * i.e. the span between the newest and oldest is within the window. Uses
 * min/max so the verdict is independent of array ordering. An empty
 * input is never "within" a window.
 */
export const isWithinWindow = (timestamps: readonly number[], windowMs: number): boolean => {
  if (timestamps.length === 0) return false;
  return Math.max(...timestamps) - Math.min(...timestamps) <= windowMs;
};
