/**
 * Retry policy for the backup walker's Discord calls.
 *
 * The shared `retryFetch` default (five attempts from a two-second
 * backoff, roughly 15–45 seconds in total) is sized for interactive
 * paths that must answer a user promptly. A backup pass answers nobody:
 * it runs unattended in the background, one guild at a time, and the
 * only cost of waiting is a later finish. It should therefore ride out
 * a host-level outage of several minutes — a route flap or an upstream
 * blip long enough to expire the gateway's handshake — instead of
 * abandoning the channel and deferring it a whole pass.
 *
 * Seven attempts from a five-second backoff give six waits of
 * 5, 10, 20, 40, 80 and 160 seconds nominal; with the `(0.5 + random)`
 * jitter the total spans about 2.5 to 8 minutes before the walker gives
 * up. A permanent failure (4xx, Unknown Channel) still propagates at
 * once because the retry predicate is unchanged.
 */
import type { RetryOptions } from '../../../core/retry';

export const BACKUP_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 7,
  initialDelayMs: 5000,
};
