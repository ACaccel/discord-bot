/**
 * X (Twitter) timeline-source types and Strategy interface.
 *
 * Lives in the infra layer alongside `infra/llm/` and
 * `infra/link-preview/` because it is an outbound boundary: an
 * implementation reads an account's recent posts over HTTP. Everything
 * returned here is neutral data — no discord.js types, no rendering —
 * so the consuming `src/plugins/x-media-feed/` plugin owns all Discord
 * assembly and the source stays unit-testable without a client.
 *
 * Why a Strategy rather than one concrete client: the reachable ways to
 * read a timeline differ sharply in cost and stability (a third-party
 * public mirror today, X's metered official API tomorrow). Pinning the
 * plugin to {@link XTimelineSource} keeps that swap to one new file in
 * this directory plus one composition-root line.
 *
 * Error contract: `fetchTimeline` MUST translate transport, HTTP, and
 * parse failures onto the Result's Err rail. It never throws a
 * `DomainError` — a feed read is background work whose failure is
 * logged and retried on the next pass, never surfaced to a channel.
 */
import type { XFeedError } from '../../core/errors';
import type { Result } from '../../core/result';

/**
 * Widened {@link XFeedError} used on the Err rail of every source. The
 * params shape mirrors the LLM / link-preview convention
 * (`{ handle, status }`) so the `errors:x_feed.*` catalog templates
 * render uniformly.
 */
export type XFeedFailure = XFeedError<{ handle: string; status: string }>;

/** A single image or video attached to a post. */
export interface XPostMedia {
  readonly kind: 'photo' | 'video';
  /** Direct media URL, kept for logging and any future re-upload path. */
  readonly url: string;
}

/**
 * One post from an account's timeline, normalised to the fields the
 * feed needs.
 *
 * `id` stays a **string**. X post ids are 64-bit and already exceed
 * `Number.MAX_SAFE_INTEGER` (a live sample reads `2092744659667673582`),
 * so any comparison must go through `BigInt` — converting to `number`
 * silently collapses distinct ids and breaks de-duplication.
 */
export interface XPost {
  /** Numeric post id as a string; compare with `BigInt`, never `Number`. */
  readonly id: string;
  /** Author's handle without the leading `@`. */
  readonly authorHandle: string;
  /** Post creation time, in unix **seconds**. */
  readonly createdTimestamp: number;
  /** Canonical permalink, e.g. `https://x.com/<handle>/status/<id>`. */
  readonly url: string;
  /** True when the post replies to another post (including self-threads). */
  readonly isReply: boolean;
  /**
   * True when the entry is a repost. Note that a repost's `authorHandle`
   * is the **original** author, not the account whose timeline was read.
   */
  readonly isRepost: boolean;
  /** Attached media; empty for a text-only post. */
  readonly media: readonly XPostMedia[];
}

/** Per-call tuning for {@link XTimelineSource.fetchTimeline}. */
export interface XTimelineFetchOptions {
  /**
   * Only ask for posts newer than this unix-seconds timestamp. This is a
   * bandwidth hint, not a filter: an implementation may still return
   * older posts, so the caller must de-duplicate on {@link XPost.id}.
   */
  readonly sinceTimestamp?: number;
}

/**
 * One way of reading an account's recent posts (Strategy). Ordering is
 * not guaranteed — callers sort and filter.
 */
export interface XTimelineSource {
  /**
   * Read `handle`'s recent posts. `Ok([])` means "nothing new", which is
   * the common case for a poller and must not be treated as an error.
   */
  fetchTimeline(
    handle: string,
    options?: XTimelineFetchOptions,
  ): Promise<Result<readonly XPost[], XFeedFailure>>;
}
