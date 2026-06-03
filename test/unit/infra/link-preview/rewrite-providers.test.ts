/**
 * Unit tests for the URL-rewrite providers (Twitter/X, Instagram, Threads,
 * Facebook). `canHandle` is a pure host/path predicate; `build` now probes
 * a priority list of proxy hosts via an injected {@link OgClient}, scoring
 * video > image > text-only and posting nothing when no host yields media.
 * A per-candidate-URL fake OgClient drives the loop deterministically.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createTwitterProvider,
  createInstagramProvider,
  createThreadsProvider,
  createFacebookProvider,
  createRedditProvider,
  invalidResponseError,
} from '../../../../src/infra/link-preview';
import {
  scoreMeta,
  isJunkPreviewTitle,
} from '../../../../src/infra/link-preview/providers/rewrite-provider';
import { ok, err, isOk, type Result } from '../../../../src/core/result';
import type {
  LinkPreviewProvider,
  LinkPreviewBuildContext,
  LinkPreviewFailure,
  OgClient,
  OpenGraphMeta,
} from '../../../../src/infra/link-preview';
import type { Logger } from '../../../../src/core/logger';

const u = (href: string): URL => new URL(href);

/** Build an OpenGraphMeta with sensible empties. */
const meta = (m: Partial<OpenGraphMeta> = {}): OpenGraphMeta => ({ images: [], ...m });

type MetaResult = Result<OpenGraphMeta, LinkPreviewFailure>;

/** Fake OgClient keyed by the EXACT candidate URL the provider builds. */
const makeOgClient = (
  byUrl: Readonly<Record<string, MetaResult>>,
): { client: OgClient; fetch: ReturnType<typeof vi.fn> } => {
  const fetch = vi.fn(
    async (url: string): Promise<MetaResult> => byUrl[url] ?? ok(meta()), // unknown URL = empty (no media)
  );
  return { client: { fetch } as unknown as OgClient, fetch };
};

const makeLogger = (): Logger => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger as unknown as Logger;
};

const emptyClient = (): OgClient => makeOgClient({}).client;

/** Run build and return the chosen rewritten URL, or null. */
const buildUrl = async (
  provider: LinkPreviewProvider,
  href: string,
  ctx: LinkPreviewBuildContext = { timeoutMs: 1000 },
): Promise<string | null> => {
  const result = await provider.build(u(href), ctx);
  if (!isOk(result)) throw new Error(`expected ok for ${href}`);
  if (result.value === null) return null;
  if (result.value.kind !== 'rewritten-url') throw new Error('expected rewritten-url');
  return result.value.url;
};

// ---------------------------------------------------------------------------
// canHandle matrices (pure — no network)
// ---------------------------------------------------------------------------

describe('twitter provider canHandle', () => {
  const provider = createTwitterProvider({
    proxyHosts: ['fxtwitter.com'],
    ogClient: emptyClient(),
  });

  it('matches tweet URLs on twitter.com and x.com (incl. www/mobile)', () => {
    expect(provider.canHandle(u('https://twitter.com/jack/status/20'))).toBe(true);
    expect(provider.canHandle(u('https://x.com/jack/status/20'))).toBe(true);
    expect(provider.canHandle(u('https://mobile.twitter.com/jack/status/20'))).toBe(true);
    expect(provider.canHandle(u('https://www.x.com/jack/status/20'))).toBe(true);
  });

  it('rejects profiles, search, and already-proxied hosts', () => {
    expect(provider.canHandle(u('https://x.com/jack'))).toBe(false);
    expect(provider.canHandle(u('https://x.com/search?q=cats'))).toBe(false);
    expect(provider.canHandle(u('https://fxtwitter.com/jack/status/20'))).toBe(false);
  });

  it('rejects look-alike hosts', () => {
    expect(provider.canHandle(u('https://nottwitter.com/jack/status/20'))).toBe(false);
    expect(provider.canHandle(u('https://x.com.evil.com/jack/status/20'))).toBe(false);
  });
});

describe('instagram provider canHandle', () => {
  const provider = createInstagramProvider({
    proxyHosts: ['kkinstagram.com'],
    ogClient: emptyClient(),
  });

  it('matches post / reel / tv URLs', () => {
    expect(provider.canHandle(u('https://www.instagram.com/p/Cabc123/'))).toBe(true);
    expect(provider.canHandle(u('https://instagram.com/reel/Cxyz/'))).toBe(true);
    expect(provider.canHandle(u('https://www.instagram.com/tv/Cqqq/'))).toBe(true);
  });

  it('matches author-prefixed post / reel URLs (profile / share-link form)', () => {
    expect(provider.canHandle(u('https://www.instagram.com/nasa/reel/CvNoLm8Ouaa/'))).toBe(true);
    expect(provider.canHandle(u('https://www.instagram.com/nasa/p/Cabc123/'))).toBe(true);
    expect(provider.canHandle(u('https://instagram.com/some.user/tv/Cqqq/'))).toBe(true);
  });

  it('rejects profile URLs', () => {
    expect(provider.canHandle(u('https://www.instagram.com/someuser/'))).toBe(false);
  });
});

describe('threads provider canHandle', () => {
  const provider = createThreadsProvider({
    proxyHosts: ['vxthreads.net'],
    ogClient: emptyClient(),
  });

  it('matches post URLs on threads.net and threads.com', () => {
    expect(provider.canHandle(u('https://www.threads.net/@user/post/Cabc'))).toBe(true);
    expect(provider.canHandle(u('https://threads.com/@user/post/Cabc'))).toBe(true);
    expect(provider.canHandle(u('https://www.threads.net/t/Cabc'))).toBe(true);
  });

  it('rejects profile URLs', () => {
    expect(provider.canHandle(u('https://www.threads.net/@user'))).toBe(false);
  });
});

describe('facebook provider canHandle', () => {
  const provider = createFacebookProvider({ proxyHosts: ['facebed.com'], ogClient: emptyClient() });

  it('matches posts, videos, reels, watch, and fb.watch', () => {
    expect(provider.canHandle(u('https://www.facebook.com/page/posts/123'))).toBe(true);
    expect(provider.canHandle(u('https://www.facebook.com/page/videos/123'))).toBe(true);
    expect(provider.canHandle(u('https://www.facebook.com/reel/123'))).toBe(true);
    expect(provider.canHandle(u('https://www.facebook.com/watch/?v=123'))).toBe(true);
    expect(provider.canHandle(u('https://fb.watch/abc123/'))).toBe(true);
  });

  it('rejects bare profile URLs', () => {
    expect(provider.canHandle(u('https://www.facebook.com/someuser'))).toBe(false);
  });
});

describe('reddit provider canHandle', () => {
  const provider = createRedditProvider({ proxyHosts: ['vxreddit.com'], ogClient: emptyClient() });

  it('matches comment permalinks and share links across reddit host variants', () => {
    expect(provider.canHandle(u('https://www.reddit.com/r/funny/comments/g0xb6c/title/'))).toBe(
      true,
    );
    expect(provider.canHandle(u('https://reddit.com/r/aww/comments/abc123/'))).toBe(true);
    expect(provider.canHandle(u('https://old.reddit.com/r/pics/comments/haucpf/slug/'))).toBe(true);
    expect(provider.canHandle(u('https://np.reddit.com/comments/abc123'))).toBe(true); // bare /comments/
    expect(provider.canHandle(u('https://www.reddit.com/r/videos/s/aB9xYz0Q'))).toBe(true); // share link
  });

  it('rejects bare subreddit, user, and home URLs', () => {
    expect(provider.canHandle(u('https://www.reddit.com/r/funny/'))).toBe(false);
    expect(provider.canHandle(u('https://www.reddit.com/user/spez/'))).toBe(false);
    expect(provider.canHandle(u('https://www.reddit.com/'))).toBe(false);
    // already-proxied hosts are not matched
    expect(provider.canHandle(u('https://vxreddit.com/r/funny/comments/g0xb6c/title/'))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Validation loop (the shared rewrite-provider logic, exercised via twitter)
// ---------------------------------------------------------------------------

describe('rewrite-provider validation loop', () => {
  const HOSTS = ['fxtwitter.com', 'vxtwitter.com'];
  const fx = 'https://fxtwitter.com/jack/status/20';
  const vx = 'https://vxtwitter.com/jack/status/20';
  const tweet = 'https://x.com/jack/status/20';

  it('short-circuits on the first host that yields a video (no debug log on the clean path)', async () => {
    const { client, fetch } = makeOgClient({ [fx]: ok(meta({ video: 'v.mp4' })) });
    const provider = createTwitterProvider({ proxyHosts: HOSTS, ogClient: client });
    const logger = makeLogger();
    expect(await buildUrl(provider, tweet, { timeoutMs: 1000, logger })).toBe(fx);
    expect(fetch).toHaveBeenCalledTimes(1); // never probed vxtwitter
    expect(fetch).toHaveBeenCalledWith(fx, 'twitter', 1000);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('chooses the first text-only host when no host has image or video', async () => {
    const { client } = makeOgClient({
      [fx]: ok(meta({ title: 'a' })),
      [vx]: ok(meta({ title: 'b' })),
    });
    const provider = createTwitterProvider({ proxyHosts: HOSTS, ogClient: client });
    expect(await buildUrl(provider, tweet)).toBe(fx);
  });

  it('prefers a later video host over an earlier image-only host', async () => {
    const { client, fetch } = makeOgClient({
      [fx]: ok(meta({ images: ['i.jpg'] })),
      [vx]: ok(meta({ video: 'v.mp4' })),
    });
    const provider = createTwitterProvider({ proxyHosts: HOSTS, ogClient: client });
    expect(await buildUrl(provider, tweet)).toBe(vx);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to the first image-bearing host when no host has video', async () => {
    const { client } = makeOgClient({
      [fx]: ok(meta({ images: ['a.jpg'] })),
      [vx]: ok(meta({ images: ['b.jpg'] })),
    });
    const provider = createTwitterProvider({ proxyHosts: HOSTS, ogClient: client });
    expect(await buildUrl(provider, tweet)).toBe(fx);
  });

  it('uses a text-only host only when no host has image or video', async () => {
    const { client } = makeOgClient({
      [fx]: ok(meta({ title: 'just text' })),
      [vx]: ok(meta({ images: ['b.jpg'] })),
    });
    const provider = createTwitterProvider({ proxyHosts: HOSTS, ogClient: client });
    // image beats text even though the text host came first
    expect(await buildUrl(provider, tweet)).toBe(vx);
  });

  it('returns null (skip, no bare link) when no host yields anything usable', async () => {
    const { client } = makeOgClient({
      [fx]: ok(meta()),
      [vx]: err(invalidResponseError('twitter')),
    });
    const provider = createTwitterProvider({ proxyHosts: HOSTS, ogClient: client });
    expect(await buildUrl(provider, tweet)).toBeNull();
  });

  it('logs a failed host probe at debug and continues to the next', async () => {
    const { client, fetch } = makeOgClient({
      [fx]: err(invalidResponseError('twitter')),
      [vx]: ok(meta({ video: 'v.mp4' })),
    });
    const provider = createTwitterProvider({ proxyHosts: HOSTS, ogClient: client });
    const logger = makeLogger();
    expect(await buildUrl(provider, tweet, { timeoutMs: 1000, logger })).toBe(vx);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('stops probing once the validation budget elapses, using the best so far', async () => {
    const { client, fetch } = makeOgClient({
      [fx]: ok(meta({ images: ['a.jpg'] })), // image-only -> remembered
      [vx]: ok(meta({ video: 'v.mp4' })), // would win, but we never reach it
    });
    const provider = createTwitterProvider({ proxyHosts: HOSTS, ogClient: client });
    // now(): first call computes the deadline (0 + 100); the loop-top check
    // after host 1 sees 10_000 >= 100 and breaks before probing host 2.
    const times = [0, 10_000];
    const now = (): number => times.shift() ?? 10_000;
    expect(await buildUrl(provider, tweet, { timeoutMs: 1000, budgetMs: 100, now })).toBe(fx);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when the budget elapses before any host yields a candidate', async () => {
    const { client, fetch } = makeOgClient({
      [fx]: err(invalidResponseError('twitter')), // host 1 fails -> no candidate remembered
      [vx]: ok(meta({ video: 'v.mp4' })), // would win, but budget stops us first
    });
    const provider = createTwitterProvider({ proxyHosts: HOSTS, ogClient: client });
    const times = [0, 10_000];
    const now = (): number => times.shift() ?? 10_000;
    expect(await buildUrl(provider, tweet, { timeoutMs: 1000, budgetMs: 100, now })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Login-wall / junk-OG rejection (scoreMeta + end-to-end)
// ---------------------------------------------------------------------------

describe('scoreMeta login-wall / junk rejection', () => {
  it('flags known login-wall / not-found placeholder titles', () => {
    expect(isJunkPreviewTitle('Log in or sign up to view')).toBe(true);
    expect(isJunkPreviewTitle('See posts, photos and more on Facebook.')).toBe(true);
    expect(isJunkPreviewTitle('a perfectly normal tweet')).toBe(false);
  });

  it('scores a login-wall placeholder as none (never a usable text card)', () => {
    expect(scoreMeta(meta({ title: 'Log in or sign up to view' }))).toBe('none');
    // even when the wall serves a generic logo image
    expect(scoreMeta(meta({ title: 'Log in or sign up to view', images: ['logo.png'] }))).toBe(
      'none',
    );
  });

  it('rejects a vxReddit proxy-error page (title is the proxy name / description says failed)', () => {
    expect(isJunkPreviewTitle('vxReddit')).toBe(true);
    // vxReddit's error page: og:title="vxReddit", og:description="Failed to get data from Reddit"
    expect(
      scoreMeta(meta({ title: 'vxReddit', description: 'Failed to get data from Reddit' })),
    ).toBe('none');
    // description marker alone is enough even if the title were generic
    expect(
      scoreMeta(meta({ title: 'reddit', description: 'Failed to get data from Reddit' })),
    ).toBe('none');
  });

  it('still scores real media / text above the junk filter', () => {
    expect(scoreMeta(meta({ title: 'Log in or sign up to view', video: 'v.mp4' }))).toBe('video');
    expect(scoreMeta(meta({ title: 'just a normal post' }))).toBe('text');
    expect(scoreMeta(meta({ images: ['i.jpg'] }))).toBe('image');
  });

  it('returns null (no broken card) when every proxy yields only a login wall', async () => {
    const fx = 'https://fxtwitter.com/jack/status/20';
    const vx = 'https://vxtwitter.com/jack/status/20';
    const { client } = makeOgClient({
      [fx]: ok(meta({ title: 'Log in or sign up to view' })),
      [vx]: ok(meta({ title: 'Log in or sign up to view' })),
    });
    const provider = createTwitterProvider({
      proxyHosts: ['fxtwitter.com', 'vxtwitter.com'],
      ogClient: client,
    });
    expect(await buildUrl(provider, 'https://x.com/jack/status/20')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-provider rewrite / query handling + host-list ordering
// ---------------------------------------------------------------------------

describe('rewrite URL construction', () => {
  it('twitter drops the query string', async () => {
    const url = 'https://fxtwitter.com/jack/status/20';
    const { client } = makeOgClient({ [url]: ok(meta({ video: 'v.mp4' })) });
    const provider = createTwitterProvider({ proxyHosts: ['fxtwitter.com'], ogClient: client });
    expect(await buildUrl(provider, 'https://x.com/jack/status/20?s=46')).toBe(url);
  });

  it('instagram drops the query string', async () => {
    const url = 'https://kkinstagram.com/reel/Cabc/';
    const { client } = makeOgClient({ [url]: ok(meta({ video: 'v.mp4' })) });
    const provider = createInstagramProvider({
      proxyHosts: ['kkinstagram.com'],
      ogClient: client,
    });
    expect(await buildUrl(provider, 'https://www.instagram.com/reel/Cabc/?igsh=xyz')).toBe(url);
  });

  it('facebook PRESERVES the query string (watch ids live there)', async () => {
    const url = 'https://facebed.com/watch/?v=123';
    const { client } = makeOgClient({ [url]: ok(meta({ video: 'v.mp4' })) });
    const provider = createFacebookProvider({ proxyHosts: ['facebed.com'], ogClient: client });
    expect(await buildUrl(provider, 'https://www.facebook.com/watch/?v=123')).toBe(url);
  });

  it('threads probes its hosts in priority order until one yields media', async () => {
    const third = 'https://threadsez.com/@user/post/Cabc';
    const { client, fetch } = makeOgClient({ [third]: ok(meta({ video: 'v.mp4' })) });
    const provider = createThreadsProvider({
      proxyHosts: ['vxthreads.net', 'viewthreads.com', 'threadsez.com'],
      ogClient: client,
    });
    expect(await buildUrl(provider, 'https://www.threads.net/@user/post/Cabc')).toBe(third);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://vxthreads.net/@user/post/Cabc',
      'https://viewthreads.com/@user/post/Cabc',
      third,
    ]);
  });
});
