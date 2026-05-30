/**
 * Reference-counted set of channels with a reply attempt in flight.
 *
 * A plain `Set` cannot track overlapping attempts on the same channel: a
 * force-triggered reply bypasses the in-flight check but still occupies the
 * channel, so two attempts can overlap. With a Set, the first attempt's
 * cleanup would delete the single entry and clear the guard while the
 * second is still running, re-opening the race. Counting per channel keeps
 * the channel marked busy until the LAST in-flight attempt finishes.
 */
export class InFlightChannels {
  private readonly counts = new Map<string, number>();

  /** Whether at least one reply attempt is currently in flight for `channelId`. */
  public isActive(channelId: string): boolean {
    return (this.counts.get(channelId) ?? 0) > 0;
  }

  /** Mark the start of a reply attempt for `channelId`. */
  public begin(channelId: string): void {
    this.counts.set(channelId, (this.counts.get(channelId) ?? 0) + 1);
  }

  /** Mark the end of a reply attempt for `channelId`. */
  public end(channelId: string): void {
    const next = (this.counts.get(channelId) ?? 0) - 1;
    if (next <= 0) {
      this.counts.delete(channelId);
    } else {
      this.counts.set(channelId, next);
    }
  }
}
