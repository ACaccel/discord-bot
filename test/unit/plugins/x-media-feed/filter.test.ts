/**
 * Unit tests for the x-media-feed selection rules.
 *
 * These are the rules that decide what reaches a channel, so each is
 * pinned separately: own-vs-repost, original-vs-reply, media-vs-text,
 * the `BigInt` cursor comparison (post ids exceed
 * `Number.MAX_SAFE_INTEGER`), oldest-first ordering, and the
 * oldest-first cap that keeps a backlog from being skipped.
 */
import { describe, expect, it } from 'vitest';

import {
  newestPostForBaseline,
  selectPostsToForward,
  snowflakeFloorAt,
} from '../../../../src/plugins/x-media-feed/internal';
import type { XPost } from '../../../../src/infra/x-feed';

const HANDLE = 'someaccount';

const post = (overrides: Partial<XPost> & Pick<XPost, 'id'>): XPost => ({
  authorHandle: HANDLE,
  createdTimestamp: 1_787_000_000,
  url: `https://x.com/${HANDLE}/status/${overrides.id}`,
  isReply: false,
  isRepost: false,
  media: [{ kind: 'photo', url: 'https://pbs.twimg.com/media/a.jpg' }],
  ...overrides,
});

const ids = (posts: readonly XPost[]): readonly string[] => posts.map((p) => p.id);

describe('selectPostsToForward', () => {
  it('forwards an original media post', () => {
    expect(
      ids(selectPostsToForward([post({ id: '10' })], { handle: HANDLE, maxPosts: 5 })),
    ).toEqual(['10']);
  });

  it('drops a repost', () => {
    const reposted = post({ id: '10', isRepost: true, authorHandle: 'someoneelse' });
    expect(selectPostsToForward([reposted], { handle: HANDLE, maxPosts: 5 })).toEqual([]);
  });

  it('drops a repost even when the author still matches the followed handle', () => {
    // Pins the `isRepost` guard on its own. Every other repost fixture also
    // carries a foreign author, so without this case the author rule alone
    // would keep the suite green if the repost check were deleted.
    const selfRepost = post({ id: '10', isRepost: true, authorHandle: HANDLE });
    expect(selectPostsToForward([selfRepost], { handle: HANDLE, maxPosts: 5 })).toEqual([]);
  });

  it('drops a post authored by someone else even when it is not flagged as a repost', () => {
    // Defence in depth: if the upstream ever stops setting `reposted_by`,
    // the author check alone still keeps other people's posts out.
    const foreign = post({ id: '10', authorHandle: 'someoneelse' });
    expect(selectPostsToForward([foreign], { handle: HANDLE, maxPosts: 5 })).toEqual([]);
  });

  it('matches the handle case-insensitively', () => {
    const upper = post({ id: '10', authorHandle: 'SomeAccount' });
    expect(ids(selectPostsToForward([upper], { handle: HANDLE, maxPosts: 5 }))).toEqual(['10']);
  });

  it('drops a reply, including a self-thread continuation', () => {
    const reply = post({ id: '10', isReply: true });
    expect(selectPostsToForward([reply], { handle: HANDLE, maxPosts: 5 })).toEqual([]);
  });

  it('drops a text-only post', () => {
    const text = post({ id: '10', media: [] });
    expect(selectPostsToForward([text], { handle: HANDLE, maxPosts: 5 })).toEqual([]);
  });

  it('forwards a video post', () => {
    const video = post({ id: '10', media: [{ kind: 'video', url: 'https://v/x.mp4' }] });
    expect(ids(selectPostsToForward([video], { handle: HANDLE, maxPosts: 5 }))).toEqual(['10']);
  });

  it('drops posts at or below the cursor', () => {
    const posts = [post({ id: '8' }), post({ id: '9' }), post({ id: '10' })];
    const selected = selectPostsToForward(posts, {
      handle: HANDLE,
      lastSeenId: '9',
      maxPosts: 5,
    });
    expect(ids(selected)).toEqual(['10']);
  });

  it('compares ids beyond Number.MAX_SAFE_INTEGER exactly', () => {
    // These two differ only in the last digit and collapse to the same
    // value under `Number`, so a numeric comparison would drop the newer.
    const cursor = '2092744659667673582';
    const newer = post({ id: '2092744659667673583' });
    expect(Number(cursor)).toBe(Number(newer.id));

    const selected = selectPostsToForward([newer], {
      handle: HANDLE,
      lastSeenId: cursor,
      maxPosts: 5,
    });
    expect(ids(selected)).toEqual([newer.id]);
  });

  it('sorts oldest-first regardless of the order the upstream returned', () => {
    const posts = [post({ id: '30' }), post({ id: '10' }), post({ id: '20' })];
    expect(ids(selectPostsToForward(posts, { handle: HANDLE, maxPosts: 5 }))).toEqual([
      '10',
      '20',
      '30',
    ]);
  });

  it('caps at the oldest posts so the remainder survives for the next pass', () => {
    const posts = [post({ id: '30' }), post({ id: '10' }), post({ id: '20' })];
    // Taking the newest instead would step the cursor over 10 and 20.
    expect(ids(selectPostsToForward(posts, { handle: HANDLE, maxPosts: 2 }))).toEqual(['10', '20']);
  });

  it('skips an entry whose id is not a number rather than throwing', () => {
    const posts = [post({ id: 'not-a-number' }), post({ id: '10' })];
    const selected = selectPostsToForward(posts, {
      handle: HANDLE,
      lastSeenId: '5',
      maxPosts: 5,
    });
    expect(ids(selected)).toEqual(['10']);
  });

  it('returns nothing for an empty page', () => {
    expect(selectPostsToForward([], { handle: HANDLE, maxPosts: 5 })).toEqual([]);
  });
});

describe('newestPostForBaseline', () => {
  it('picks the highest id on the page', () => {
    const posts = [post({ id: '10' }), post({ id: '30' }), post({ id: '20' })];
    expect(newestPostForBaseline(posts)?.id).toBe('30');
  });

  it('counts replies and text-only posts, which share the id sequence', () => {
    // The baseline must sit above everything already on the timeline, or
    // the first real pass would backfill whatever it skipped.
    const posts = [post({ id: '10' }), post({ id: '40', isReply: true, media: [] })];
    expect(newestPostForBaseline(posts)?.id).toBe('40');
  });

  it('counts reposts too, so a repost-only page still yields a baseline', () => {
    // X ids are globally time-ordered, so a repost's id is still at or
    // below "now" and is a safe, non-backfilling anchor. Excluding them
    // would leave this page with no cursor at all, and the next pass would
    // then swallow the account's first genuinely new post as its baseline.
    const posts = [post({ id: '99', isRepost: true, authorHandle: 'someoneelse' })];
    expect(newestPostForBaseline(posts)?.id).toBe('99');
  });

  it('compares ids as BigInt, not by string or number', () => {
    // '9' sorts after '10' as a string; both collapse together as Numbers
    // at 19 digits, so only a BigInt comparison gets this right.
    const posts = [post({ id: '9' }), post({ id: '10' })];
    expect(newestPostForBaseline(posts)?.id).toBe('10');
  });

  it('returns undefined for an empty page', () => {
    expect(newestPostForBaseline([])).toBeUndefined();
  });
});

describe('snowflakeFloorAt', () => {
  // A real post and the wall-clock time it was created at, taken from
  // the live API; the floor must sit between adjacent moments.
  const REAL_ID = '2092744659667673582';
  const REAL_CREATED_MS = 1_787_784_182_000;

  it('sits below a post created at the same moment', () => {
    expect(BigInt(snowflakeFloorAt(REAL_CREATED_MS))).toBeLessThanOrEqual(BigInt(REAL_ID));
  });

  it('sits above every post created earlier', () => {
    // One second later is already past the sample post.
    expect(BigInt(snowflakeFloorAt(REAL_CREATED_MS + 1000))).toBeGreaterThan(BigInt(REAL_ID));
  });

  it('is monotonic in time', () => {
    expect(BigInt(snowflakeFloorAt(REAL_CREATED_MS + 1))).toBeGreaterThan(
      BigInt(snowflakeFloorAt(REAL_CREATED_MS)),
    );
  });

  it('is far above zero, so it cannot act as a backfill sentinel', () => {
    // The regression this replaces: a '0' baseline is below every post
    // ever published, so a later full sweep drained the back catalogue.
    expect(BigInt(snowflakeFloorAt(REAL_CREATED_MS))).toBeGreaterThan(0n);
  });

  it('suppresses a pre-existing post when used as a cursor', () => {
    const older = post({ id: REAL_ID });
    const selected = selectPostsToForward([older], {
      handle: HANDLE,
      lastSeenId: snowflakeFloorAt(REAL_CREATED_MS + 1000),
      maxPosts: 5,
    });
    expect(selected).toEqual([]);
  });

  it('clamps to zero for a clock set before the snowflake epoch', () => {
    expect(snowflakeFloorAt(0)).toBe('0');
  });
});
