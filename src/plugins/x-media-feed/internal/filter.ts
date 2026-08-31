/**
 * Pure selection logic over a fetched timeline page: which entries are
 * the account's own original media posts, which of those are new, and
 * where the cursor should land.
 *
 * Kept free of I/O so every rule below is unit-testable without a
 * network, a database, or a Discord client.
 */
import type { XPost } from '../../../infra/x-feed';

/** Inputs to {@link selectPostsToForward}. */
interface SelectPostsInput {
  /** Configured handle, used to reject entries authored by someone else. */
  readonly handle: string;
  /** Newest post id already forwarded; absent before the first pass. */
  readonly lastSeenId?: string;
  /** Upper bound on how many posts one pass may forward. */
  readonly maxPosts: number;
}

/**
 * Start of X's snowflake epoch, in Unix milliseconds.
 *
 * A fixed protocol value: post ids embed `(createdMs - EPOCH) << 22`, so
 * this constant is what makes an id and a wall-clock time comparable.
 * Verified against live posts — decoding each sample's id reproduces its
 * reported `created_timestamp` to the second.
 */
const SNOWFLAKE_EPOCH_MS = 1_288_834_974_657;

/** Bits an X snowflake reserves below the timestamp (worker + sequence). */
const SNOWFLAKE_TIMESTAMP_SHIFT = 22n;

/**
 * The lowest id a post created at `atMs` could carry.
 *
 * Used to anchor a cursor when there is no real post to anchor on — an
 * account whose timeline reads empty on the first pass. A plain `'0'`
 * would be below *every* post ever published, so the next full sweep
 * (which drops the `since` hint and returns the whole page) would treat
 * the account's entire back catalogue as new and drain it into the
 * channel. A time-derived floor is above everything already published
 * and below everything published afterwards, which is exactly the
 * no-backfill semantics the first pass is supposed to establish.
 *
 * Clamped at zero so a badly-wrong system clock degrades to the old
 * permissive floor rather than producing a negative id.
 */
export const snowflakeFloorAt = (atMs: number): string => {
  if (atMs <= SNOWFLAKE_EPOCH_MS) return '0';
  return (
    (BigInt(Math.floor(atMs)) - BigInt(SNOWFLAKE_EPOCH_MS)) <<
    SNOWFLAKE_TIMESTAMP_SHIFT
  ).toString();
};

/**
 * Parse an X post id for comparison.
 *
 * Ids are 64-bit and already exceed `Number.MAX_SAFE_INTEGER`, so
 * `BigInt` is the only safe comparison. A non-numeric id means the
 * upstream id format changed; `null` makes the caller skip that entry
 * rather than throw inside a background loop.
 */
const toBigIntOrNull = (id: string): bigint | null => {
  try {
    return BigInt(id);
  } catch {
    return null;
  }
};

/** Ascending (oldest-first) comparison, so a channel reads chronologically. */
const byIdAscending = (a: XPost, b: XPost): number => {
  const left = toBigIntOrNull(a.id);
  const right = toBigIntOrNull(b.id);
  if (left === null || right === null) return 0;
  if (left < right) return -1;
  return left > right ? 1 : 0;
};

/**
 * True when the entry is a post this account itself published — not a
 * repost of someone else's.
 *
 * `isRepost` is the upstream's own marker; the author comparison is a
 * second, independent check, because a repost entry carries the
 * *original* author. Handles are case-insensitive on X.
 */
const isOwnPost = (post: XPost, handle: string): boolean =>
  !post.isRepost && post.authorHandle.toLowerCase() === handle.toLowerCase();

/**
 * Highest-id entry on the page, used to seed a cursor on the very first
 * pass so an account joining the feed does not replay its timeline.
 *
 * Deliberately considers **every** entry, reposts and replies included,
 * rather than only the account's own posts. X ids are globally
 * time-ordered, so the highest id present is at or above everything
 * already published and any later post compares greater — which keeps
 * the baseline non-backfilling. Restricting it to own posts would return
 * `undefined` for a repost-only page, leaving no cursor, and the next
 * pass would then consume the account's first genuinely new post as its
 * baseline instead of forwarding it.
 *
 * Returns `undefined` only for an empty page, where there is no id to
 * anchor on and the caller supplies its own baseline.
 */
export const newestPostForBaseline = (posts: readonly XPost[]): XPost | undefined => {
  const sorted = [...posts].sort(byIdAscending);
  return sorted[sorted.length - 1];
};

/**
 * Choose the posts a pass should forward: the account's own, original
 * (non-reply), media-carrying posts newer than the cursor, oldest first.
 *
 * The cap takes the **oldest** eligible posts rather than the newest.
 * Because the caller advances the cursor only to the last post it
 * actually delivered, the remainder is picked up by the following pass;
 * taking the newest instead would step the cursor over the middle of the
 * backlog and drop it permanently.
 */
export const selectPostsToForward = (
  posts: readonly XPost[],
  input: SelectPostsInput,
): readonly XPost[] => {
  const cursor = input.lastSeenId === undefined ? null : toBigIntOrNull(input.lastSeenId);
  const eligible = posts.filter((post) => {
    if (!isOwnPost(post, input.handle)) return false;
    // Replies (including this account's own thread continuations) are
    // not original posts, so they stay out of the feed.
    if (post.isReply) return false;
    if (post.media.length === 0) return false;
    if (cursor === null) return true;
    const id = toBigIntOrNull(post.id);
    return id !== null && id > cursor;
  });
  return [...eligible].sort(byIdAscending).slice(0, input.maxPosts);
};
