/**
 * Per-channel reply cooldown for the LLM auto-reply plugin.
 *
 * Enforces a minimum gap between two consecutive replies in the same
 * channel so the bot cannot post back-to-back replies. An @-mention reply
 * skips the {@link isReady} check but still calls {@link record}, so a
 * following automatic reply still observes the gap.
 *
 * Timestamps are supplied by the caller (the triggering message's
 * creation time) rather than read from a clock here, keeping the tracker
 * pure and deterministic to test.
 */
export class ReplyCooldown {
  /** channelId -> timestamp (ms) of the last reply posted there. */
  private readonly lastReplyAt = new Map<string, number>();

  /**
   * @param cooldownMs Minimum gap between replies in one channel.
   *   `<= 0` disables the cooldown (every channel is always ready).
   */
  public constructor(private readonly cooldownMs: number) {}

  /** Whether enough time has elapsed since the last reply in `channelId`. */
  public isReady(channelId: string, now: number): boolean {
    if (this.cooldownMs <= 0) return true;
    const last = this.lastReplyAt.get(channelId);
    return last === undefined || now - last >= this.cooldownMs;
  }

  /**
   * Record that a reply was posted in `channelId` at `now`. Monotonic: a
   * smaller (out-of-order) timestamp never regresses a later one, so an
   * interleaved older message cannot shorten the cooldown.
   */
  public record(channelId: string, now: number): void {
    const last = this.lastReplyAt.get(channelId);
    if (last === undefined || now > last) {
      this.lastReplyAt.set(channelId, now);
    }
  }
}
