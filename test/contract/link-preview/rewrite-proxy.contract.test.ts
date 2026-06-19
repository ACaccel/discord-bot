/**
 * Contract test for the rewrite-provider validation loop at the real HTTP
 * boundary (nock, real axios + OgClient). The four rewrite providers share
 * one loop, so Twitter stands in for all. Pins: video short-circuit, fall-
 * through on a failed host, `ok(null)` when nothing yields media, that the
 * wire follows a legit public redirect under the Discordbot UA, and that a
 * redirect to an internal address (incl. IPv4-mapped IPv6) is refused.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';

import {
  OgClient,
  createTwitterProvider,
  createFacebookProvider,
  createBilibiliProvider,
} from '../../../src/infra/link-preview';
import { isOk } from '../../../src/core/result';
import type { LinkPreviewProvider, LinkPreviewResult } from '../../../src/infra/link-preview';

const HOSTS = ['fxtwitter.com', 'vxtwitter.com'];
const PATH = '/jack/status/20';
const TWEET = new URL(`https://x.com${PATH}`);
const fxUrl = `https://fxtwitter.com${PATH}`;
const vxUrl = `https://vxtwitter.com${PATH}`;

const ogHtml = (head: string): string =>
  `<!doctype html><html><head>${head}</head><body>x</body></html>`;
const VIDEO_HEAD = '<meta property="og:video:secure_url" content="https://cdn.example/v.mp4">';
const IMAGE_HEAD = '<meta property="og:image" content="https://cdn.example/i.jpg">';

const provider = (): LinkPreviewProvider =>
  createTwitterProvider({ proxyHosts: HOSTS, ogClient: new OgClient() });

const build = async (): Promise<string | null> => {
  const result = await provider().build(TWEET, { timeoutMs: 4000, budgetMs: 8000 });
  if (!isOk(result)) throw new Error('expected ok');
  if (result.value === null) return null;
  if (result.value.kind !== 'rewritten-url') throw new Error('expected rewritten-url');
  return result.value.url;
};

describe('rewrite-provider proxy validation contract', () => {
  beforeAll(() => {
    if (!nock.isActive()) nock.activate();
    nock.disableNetConnect();
  });
  afterEach(() => {
    // Every registered interceptor must be consumed — a leftover means the
    // probe sequence diverged from what the test expected.
    expect(nock.pendingMocks()).toEqual([]);
    nock.cleanAll();
  });
  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('short-circuits on the first host that serves og:video (second host never probed)', async () => {
    // Only the first host is stubbed; if the loop probed the second, nock
    // would throw "no match" — so this also proves the short-circuit.
    nock('https://fxtwitter.com').get(PATH).reply(200, ogHtml(VIDEO_HEAD));
    expect(await build()).toBe(fxUrl);
  });

  it('falls through a 5xx host to a later host with media', async () => {
    nock('https://fxtwitter.com').get(PATH).reply(503, 'down');
    nock('https://vxtwitter.com').get(PATH).reply(200, ogHtml(IMAGE_HEAD));
    expect(await build()).toBe(vxUrl);
  });

  it('returns null (posts nothing) when no host yields media', async () => {
    nock('https://fxtwitter.com').get(PATH).reply(200, ogHtml('<title>nope</title>'));
    nock('https://vxtwitter.com').get(PATH).reply(200, ogHtml('<title>nope</title>'));
    expect(await build()).toBeNull();
  });

  it('sends the Discordbot UA and follows a legit public redirect to obtain media', async () => {
    // Embed proxies (e.g. kkinstagram) 301 to a render host; we follow it
    // (as Discord does) and read the OG there, but still post the ORIGINAL
    // proxy URL — Discord re-fetches and follows the same chain.
    nock('https://fxtwitter.com', { reqheaders: { 'user-agent': /Discordbot\/2\.0/ } })
      .get(PATH)
      .reply(301, '', { Location: 'https://render.example.com/v/20' });
    nock('https://render.example.com').get('/v/20').reply(200, ogHtml(VIDEO_HEAD));
    expect(await build()).toBe(fxUrl);
  });

  it('refuses a redirect to an internal address (SSRF guard) and falls through', async () => {
    // A 3xx to a private/link-local target must be blocked, not chased; the
    // loop then falls through to the next host.
    nock('https://fxtwitter.com')
      .get(PATH)
      .reply(302, '', { Location: 'http://169.254.169.254/latest/meta-data/' });
    nock('https://vxtwitter.com').get(PATH).reply(200, ogHtml(VIDEO_HEAD));
    expect(await build()).toBe(vxUrl);
  });

  it('refuses an IPv4-mapped IPv6 redirect to the metadata service and falls through', async () => {
    // `::ffff:169.254.169.254` routes to the IPv4 metadata endpoint; the guard
    // must block it end-to-end (URL parser -> beforeRedirect), not just for
    // the dotted form.
    nock('https://fxtwitter.com')
      .get(PATH)
      .reply(302, '', { Location: 'http://[::ffff:169.254.169.254]/latest/meta-data/' });
    nock('https://vxtwitter.com').get(PATH).reply(200, ogHtml(VIDEO_HEAD));
    expect(await build()).toBe(vxUrl);
  });

  it('treats a redirect straight to a video file as a playable preview (kkinstagram-style)', async () => {
    // Some proxies (e.g. kkinstagram) 302 the bot UA straight to a *.mp4 on a
    // CDN with no OpenGraph HTML; Discord follows the same redirect and embeds
    // the file. A `video/*` Content-Type is therefore a valid preview, and we
    // post the ORIGINAL proxy URL. Classification is from headers alone (that
    // the body is never buffered is pinned in the og-client unit test).
    nock('https://fxtwitter.com')
      .get(PATH)
      .reply(302, '', { Location: 'https://cdn.example.com/v/20.mp4' });
    nock('https://cdn.example.com')
      .get('/v/20.mp4')
      .reply(200, 'mp4-bytes', { 'Content-Type': 'video/mp4' });
    expect(await build()).toBe(fxUrl);
  });

  it('counts a video-file redirect as a hit even when the CDN is unreachable from the bot host', async () => {
    // The proxy 302s to a *.mp4, but our host cannot reach the CDN (no
    // interceptor under disableNetConnect -> the hop fails). Discord CAN reach
    // it, and the redirect target is sufficient proof of video, so we still
    // post the proxy URL instead of falling through to a weaker host.
    nock('https://fxtwitter.com')
      .get(PATH)
      .reply(302, '', { Location: 'https://unreachable-cdn.example.com/v/20.mp4' });
    // Intentionally no interceptor for unreachable-cdn.example.com.
    expect(await build()).toBe(fxUrl);
  });
});

// ---------------------------------------------------------------------------
// Facebook share-link expansion + OpenGraph card fallback, at the wire
// ---------------------------------------------------------------------------

describe('facebook share-link resolution contract', () => {
  const SHARE_PATH = '/share/r/1AcYfs5CNq/';
  const SHARE = new URL(`https://www.facebook.com${SHARE_PATH}`);
  const CANON_PATH = '/61585725097605/videos/866774919797953/';
  const CANON = `https://www.facebook.com${CANON_PATH}`;
  const PROXY_CANON = `https://facebed.com${CANON_PATH}`;

  const buildFb = async (url: URL): Promise<LinkPreviewResult | null> => {
    const provider = createFacebookProvider({
      proxyHosts: ['facebed.com'],
      ogClient: new OgClient(),
    });
    const result = await provider.build(url, { timeoutMs: 4000, budgetMs: 8000 });
    if (!isOk(result)) throw new Error('expected ok');
    return result.value;
  };

  beforeAll(() => {
    if (!nock.isActive()) nock.activate();
    nock.disableNetConnect();
  });
  afterEach(() => {
    expect(nock.pendingMocks()).toEqual([]);
    nock.cleanAll();
  });
  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('chases the browser-UA redirect to the canonical, then proxies it for a playable video', async () => {
    // Facebook only redirects a share link to its canonical permalink for a
    // NON-crawler UA; the cookieless destination page body is irrelevant.
    nock('https://www.facebook.com', { reqheaders: { 'user-agent': /Chrome\// } })
      .get(SHARE_PATH)
      .reply(302, '', { Location: CANON });
    nock('https://www.facebook.com', { reqheaders: { 'user-agent': /Chrome\// } })
      .get(CANON_PATH)
      .reply(200, '<html><head><title>error</title></head><body>x</body></html>');
    // The Discord-crawler-UA proxy probe of the canonical yields og:video.
    nock('https://facebed.com', { reqheaders: { 'user-agent': /Discordbot\/2\.0/ } })
      .get(CANON_PATH)
      .reply(200, ogHtml(VIDEO_HEAD));

    expect(await buildFb(SHARE)).toEqual({
      kind: 'rewritten-url',
      url: PROXY_CANON,
      sourceUrl: SHARE.href,
    });
  });

  it('falls back to a Facebook OpenGraph card when resolution fails and the proxy is a login wall', async () => {
    // No interceptor for the browser-UA resolution -> it errors (host
    // unreachable under disableNetConnect), so the original /share/ link is
    // probed; the proxy serves a login wall (junk), and we build a card from
    // Facebook's own OpenGraph (served to the Discord crawler UA).
    nock('https://facebed.com', { reqheaders: { 'user-agent': /Discordbot\/2\.0/ } })
      .get(SHARE_PATH)
      .reply(200, ogHtml('<meta property="og:title" content="Log in or sign up to view">'));
    nock('https://www.facebook.com', { reqheaders: { 'user-agent': /Discordbot\/2\.0/ } })
      .get(SHARE_PATH)
      .reply(
        200,
        ogHtml(
          [
            '<meta property="og:title" content="Lil mouse">',
            '<meta property="og:image" content="https://scontent.example/thumb.jpg">',
            '<meta property="og:url" content="https://www.facebook.com/p/1/">',
          ].join(''),
        ),
      );

    expect(await buildFb(SHARE)).toEqual({
      kind: 'card',
      card: {
        url: 'https://www.facebook.com/p/1/',
        title: 'Lil mouse',
        description: undefined,
        imageUrl: 'https://scontent.example/thumb.jpg',
        siteName: 'Facebook',
      },
      sourceUrl: SHARE.href,
    });
  });
});

// ---------------------------------------------------------------------------
// Bilibili b23.tv short-link resolution, at the wire
// ---------------------------------------------------------------------------

describe('bilibili b23.tv resolution contract', () => {
  const B23_PATH = '/mHCI3y3';
  const B23 = new URL(`https://b23.tv${B23_PATH}`);
  const VIDEO_PATH = '/video/BV1xx411c7mD';
  const CANON = `https://www.bilibili.com${VIDEO_PATH}`;
  const PROXY = `https://vxbilibili.com${VIDEO_PATH}`;

  const buildB23 = async (url: URL): Promise<LinkPreviewResult | null> => {
    const provider = createBilibiliProvider({
      proxyHosts: ['vxbilibili.com'],
      ogClient: new OgClient(),
    });
    const result = await provider.build(url, { timeoutMs: 4000, budgetMs: 8000 });
    if (!isOk(result)) throw new Error('expected ok');
    return result.value;
  };

  beforeAll(() => {
    if (!nock.isActive()) nock.activate();
    nock.disableNetConnect();
  });
  afterEach(() => {
    expect(nock.pendingMocks()).toEqual([]);
    nock.cleanAll();
  });
  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('chases the browser-UA redirect to the canonical video, then proxies it for a playable video', async () => {
    // b23.tv 302s a browser-like UA to the canonical /video/<BV> URL; the
    // cookieless destination page body is read only to be discarded.
    nock('https://b23.tv', { reqheaders: { 'user-agent': /Chrome\// } })
      .get(B23_PATH)
      .reply(302, '', { Location: CANON });
    nock('https://www.bilibili.com', { reqheaders: { 'user-agent': /Chrome\// } })
      .get(VIDEO_PATH)
      .reply(200, '<html><head><title>x</title></head><body>x</body></html>');
    // The Discord-crawler-UA proxy probe of the canonical yields og:video.
    nock('https://vxbilibili.com', { reqheaders: { 'user-agent': /Discordbot\/2\.0/ } })
      .get(VIDEO_PATH)
      .reply(200, ogHtml(VIDEO_HEAD));

    expect(await buildB23(B23)).toEqual({
      kind: 'rewritten-url',
      url: PROXY,
      sourceUrl: B23.href, // original short link carried, not the canonical
    });
  });

  it('posts nothing when the b23.tv link resolves to a non-video page (no proxy probe)', async () => {
    // Resolves to a live page (not `/video/<BV|av>`), so the video predicate
    // rejects it and no proxy host is probed — only the resolution hops run.
    nock('https://b23.tv', { reqheaders: { 'user-agent': /Chrome\// } })
      .get(B23_PATH)
      .reply(302, '', { Location: 'https://live.bilibili.com/123' });
    nock('https://live.bilibili.com', { reqheaders: { 'user-agent': /Chrome\// } })
      .get('/123')
      .reply(200, '<html><head><title>live</title></head><body>x</body></html>');

    expect(await buildB23(B23)).toBeNull();
  });
});
