/**
 * Unit tests for {@link parseOpenGraph} (pure) and {@link OgClient.fetch}
 * (axios auto-mocked, reassigning `axios.get` per case — the
 * `selfhosted-client` pattern). `fetch` streams the response and classifies
 * it by Content-Type, so the mock returns a Readable plus headers. Covers
 * tag mapping, entity decoding, first-occurrence precedence, media-type
 * classification, head-only streaming of a large body, and the
 * transport/HTTP failure mapping.
 */
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import axios from 'axios';

import { OgClient, parseOpenGraph } from '../../../../src/infra/link-preview';
import { isUnsafeRedirectHost } from '../../../../src/infra/link-preview/og-client';
import { isErr, isOk } from '../../../../src/core/result';

vi.mock('axios');

const setGet = (impl: (...args: unknown[]) => Promise<unknown>): ReturnType<typeof vi.fn> => {
  const get = vi.fn(impl);
  (axios.get as unknown as ReturnType<typeof vi.fn>) = get;
  return get;
};

const html = (head: string): string => `<html><head>${head}</head><body>ignored</body></html>`;

/**
 * Build a streamed axios-style response. `body` is split into the supplied
 * chunks (default: one); `contentType` drives the classification path;
 * `finalUrl` mimics the http adapter's post-redirect `responseUrl`.
 */
const streamResponse = (
  body: string | readonly Buffer[],
  contentType = 'text/html; charset=utf-8',
  finalUrl = 'https://gamer.com.tw/x',
): {
  data: Readable;
  headers: Record<string, string>;
  request: { res: { responseUrl: string } };
} => ({
  data: Readable.from(typeof body === 'string' ? [Buffer.from(body, 'utf8')] : [...body]),
  headers: { 'content-type': contentType },
  request: { res: { responseUrl: finalUrl } },
});

describe('parseOpenGraph', () => {
  it('maps og:title / description / image / url / site_name', () => {
    const meta = parseOpenGraph(
      html(
        [
          '<meta property="og:title" content="A Title">',
          '<meta property="og:description" content="A description">',
          '<meta property="og:image" content="https://cdn.example/a.jpg">',
          '<meta property="og:url" content="https://example.com/post/1">',
          '<meta property="og:site_name" content="Example">',
        ].join(''),
      ),
    );
    expect(meta).toEqual({
      title: 'A Title',
      description: 'A description',
      images: ['https://cdn.example/a.jpg'],
      video: undefined,
      url: 'https://example.com/post/1',
      siteName: 'Example',
    });
  });

  it('extracts the video URL (og:video:secure_url > og:video:url > og:video)', () => {
    const meta = parseOpenGraph(
      html(
        [
          '<meta property="og:video" content="http://cdn/v-plain.mp4">',
          '<meta property="og:video:url" content="http://cdn/v-url.mp4">',
          '<meta property="og:video:secure_url" content="https://cdn/v-secure.mp4">',
        ].join(''),
      ),
    );
    expect(meta.video).toBe('https://cdn/v-secure.mp4');
  });

  it('collects ALL images in document order, de-duplicated', () => {
    const meta = parseOpenGraph(
      html(
        [
          '<meta property="og:image" content="https://cdn/1.jpg">',
          '<meta property="og:image" content="https://cdn/2.jpg">',
          '<meta property="og:image" content="https://cdn/1.jpg">',
        ].join(''),
      ),
    );
    expect(meta.images).toEqual(['https://cdn/1.jpg', 'https://cdn/2.jpg']);
  });

  it('handles content-before-property attribute order', () => {
    const meta = parseOpenGraph(html('<meta content="Reversed" property="og:title">'));
    expect(meta.title).toBe('Reversed');
  });

  it('falls back to twitter:* when og:* is absent', () => {
    const meta = parseOpenGraph(
      html(
        '<meta name="twitter:title" content="TW Title"><meta name="twitter:image" content="https://cdn/t.jpg">',
      ),
    );
    expect(meta.title).toBe('TW Title');
    expect(meta.images).toEqual(['https://cdn/t.jpg']);
  });

  it('prefers og:* over twitter:* for the same field', () => {
    const meta = parseOpenGraph(
      html('<meta property="og:title" content="OG"><meta name="twitter:title" content="TW">'),
    );
    expect(meta.title).toBe('OG');
  });

  it('keeps the first occurrence of a duplicated scalar tag', () => {
    const meta = parseOpenGraph(
      html('<meta property="og:title" content="first"><meta property="og:title" content="second">'),
    );
    expect(meta.title).toBe('first');
  });

  it('decodes named HTML entities in content', () => {
    const meta = parseOpenGraph(
      html('<meta property="og:title" content="Tom &amp; Jerry &#39;95 &quot;quoted&quot;">'),
    );
    expect(meta.title).toBe('Tom & Jerry \'95 "quoted"');
  });

  it('decodes numeric and hex entities and leaves malformed ones verbatim', () => {
    const meta = parseOpenGraph(
      html('<meta property="og:title" content="&#8364; &#x1F600; &#xZZ;">'),
    );
    expect(meta.title).toBe('€ 😀 &#xZZ;');
  });

  it('ignores meta tags after </head>', () => {
    const withBodyMeta =
      '<html><head><meta property="og:title" content="Head"></head><body><meta property="og:title" content="Body"></body></html>';
    expect(parseOpenGraph(withBodyMeta).title).toBe('Head');
  });

  it('returns empty images and all-undefined scalars when no og/twitter tags are present', () => {
    const meta = parseOpenGraph(html('<meta charset="utf-8"><title>plain</title>'));
    expect(meta).toEqual({
      title: undefined,
      description: undefined,
      images: [],
      video: undefined,
      url: undefined,
      siteName: undefined,
    });
  });
});

describe('OgClient.fetch', () => {
  it('fetches with SSRF-safe streaming options and returns parsed metadata (happy path)', async () => {
    const get = setGet(async () =>
      streamResponse(
        html('<meta property="og:title" content="Hi"><meta property="og:image" content="i.jpg">'),
      ),
    );
    const result = await new OgClient().fetch('https://gamer.com.tw/x', 'bahamut', 4000);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.title).toBe('Hi');
      expect(result.value.images).toEqual(['i.jpg']);
    }
    expect(get).toHaveBeenCalledWith(
      'https://gamer.com.tw/x',
      expect.objectContaining({
        timeout: 4000,
        // Bounded redirect-following (proxies redirect to a render/CDN host);
        // the beforeRedirect guard refuses internal hops.
        maxRedirects: 3,
        beforeRedirect: expect.any(Function),
        // Streamed so a media body is never pulled and a large HTML body is
        // read only up to its <head>.
        responseType: 'stream',
        // Default UA must be the Discord crawler UA so proxies serve OG and
        // we see exactly what Discord's unfurl will fetch.
        headers: expect.objectContaining({
          'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
          Accept: 'text/html',
        }),
      }),
    );
  });

  it('classifies a video Content-Type as a playable preview without reading the body', async () => {
    const body = Buffer.alloc(4 * 1024 * 1024, 0); // 4 MiB "video" — must NOT be buffered
    const response = streamResponse(
      [body],
      'video/mp4',
      'https://scontent.cdninstagram.com/reel.mp4',
    );
    setGet(async () => response);
    const result = await new OgClient().fetch('https://kkinstagram.com/reel/X/', 'instagram', 4000);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.video).toBe('https://scontent.cdninstagram.com/reel.mp4');
      expect(result.value.images).toEqual([]);
    }
    expect(response.data.destroyed).toBe(true); // never drained the 4 MiB body
  });

  it('classifies an image Content-Type as an image preview (final URL)', async () => {
    const response = streamResponse(
      [Buffer.from('binary')],
      'image/jpeg',
      'https://cdn.example/photo.jpg',
    );
    setGet(async () => response);
    const result = await new OgClient().fetch('https://kkinstagram.com/p/X/', 'instagram', 4000);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.images).toEqual(['https://cdn.example/photo.jpg']);
  });

  it('reads only the head of a large HTML body — never buffers it, never throws', async () => {
    // og:title sits in the first chunk; the rest dwarfs the byte cap and has
    // no </head>, so the read must stop at the cap (the old maxContentLength
    // path would have thrown on a body this large).
    const head = Buffer.from('<html><head><meta property="og:title" content="Big">');
    const filler = Buffer.alloc(50_000, 0x78); // 'x'
    const response = streamResponse([head, filler, filler, filler], 'text/html');
    setGet(async () => response);
    const result = await new OgClient({ maxContentLength: 1024 }).fetch(
      'https://gamer.com.tw/x',
      'bahamut',
      4000,
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.title).toBe('Big');
    expect(response.data.destroyed).toBe(true); // stopped early, did not drain
  });

  it('honours a custom User-Agent option', async () => {
    const get = setGet(async () => streamResponse(html('<meta property="og:title" content="x">')));
    await new OgClient({ userAgent: 'Custom-UA/9' }).fetch(
      'https://gamer.com.tw/x',
      'bahamut',
      1000,
    );
    expect(get).toHaveBeenCalledWith(
      'https://gamer.com.tw/x',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'Custom-UA/9' }),
      }),
    );
  });

  it('maps ECONNABORTED to LINK_PREVIEW_TIMEOUT', async () => {
    setGet(async () => {
      throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    });
    const result = await new OgClient().fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('LINK_PREVIEW_TIMEOUT');
  });

  it('maps HTTP 429 to LINK_PREVIEW_RATE_LIMITED', async () => {
    setGet(async () => {
      throw Object.assign(new Error('429'), { response: { status: 429 } });
    });
    const result = await new OgClient().fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('LINK_PREVIEW_RATE_LIMITED');
  });

  it('maps HTTP 503 to LINK_PREVIEW_UPSTREAM_5XX and preserves cause', async () => {
    const cause = Object.assign(new Error('down'), { response: { status: 503 } });
    setGet(async () => {
      throw cause;
    });
    const result = await new OgClient().fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('LINK_PREVIEW_UPSTREAM_5XX');
      expect(result.error.cause).toBe(cause);
    }
  });

  it('maps a generic transport error to LINK_PREVIEW_FETCH_FAILED', async () => {
    setGet(async () => {
      throw Object.assign(new Error('dns'), { code: 'ENOTFOUND' });
    });
    const result = await new OgClient().fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('LINK_PREVIEW_FETCH_FAILED');
  });
});

describe('OgClient cache', () => {
  // A fresh single-use stream per call so a cache hit is observable as a
  // SKIPPED network call (Readable is consumed once).
  const okStream = (): Promise<unknown> =>
    Promise.resolve(streamResponse(html('<meta property="og:title" content="Hi">')));

  it('serves a second fetch of the same URL from cache (one network call)', async () => {
    const get = setGet(okStream);
    const client = new OgClient({ cacheTtlMs: 60_000, now: () => 1000 });
    await client.fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    await client.fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache an error result (next call re-hits the network)', async () => {
    const get = setGet(async () => {
      throw Object.assign(new Error('boom'), { code: 'ENOTFOUND' });
    });
    const client = new OgClient({ cacheTtlMs: 60_000, now: () => 1000 });
    await client.fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    await client.fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('re-fetches after the TTL expires', async () => {
    const get = setGet(okStream);
    let clock = 1000;
    const client = new OgClient({ cacheTtlMs: 10_000, now: () => clock });
    await client.fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    clock = 1000 + 10_001; // past TTL
    await client.fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry past the max-entry cap', async () => {
    const get = setGet(okStream);
    const client = new OgClient({ cacheTtlMs: 60_000, cacheMaxEntries: 1, now: () => 1000 });
    await client.fetch('https://gamer.com.tw/a', 'bahamut', 1000); // fills cache
    await client.fetch('https://gamer.com.tw/b', 'bahamut', 1000); // evicts /a
    await client.fetch('https://gamer.com.tw/a', 'bahamut', 1000); // miss again
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('is disabled by default (every call hits the network)', async () => {
    const get = setGet(okStream);
    const client = new OgClient();
    await client.fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    await client.fetch('https://gamer.com.tw/x', 'bahamut', 1000);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('isUnsafeRedirectHost (SSRF guard)', () => {
  it('blocks loopback / private / link-local / unspecified / CGNAT IPv4', () => {
    for (const host of [
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.1',
      '172.16.0.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1', // CGNAT (RFC 6598)
    ]) {
      expect(isUnsafeRedirectHost(host)).toBe(true);
    }
  });

  it('blocks non-canonical numeric IPv4 encodings (decimal / hex / octal / short)', () => {
    for (const host of ['2130706433', '0x7f000001', '010.0.0.1', '127.1']) {
      expect(isUnsafeRedirectHost(host)).toBe(true);
    }
  });

  it('blocks loopback / ULA / link-local IPv6 in any textual form', () => {
    for (const host of [
      '::1',
      '::',
      'fc00::1',
      'fd12::34',
      'fe80::1',
      '[::1]',
      'FE80::1',
      'fe80:0:0::1',
      '0:0:0:0:0:0:0:1', // expanded loopback
      'fe80::1%eth0', // zone id
    ]) {
      expect(isUnsafeRedirectHost(host)).toBe(true);
    }
  });

  it('blocks IPv4-mapped / -compatible IPv6 and NAT64 reaching an internal IPv4', () => {
    for (const host of [
      '::ffff:127.0.0.1',
      '::ffff:7f00:1', // hex form of ::ffff:127.0.0.1
      '::ffff:169.254.169.254',
      '[::ffff:169.254.169.254]',
      '::127.0.0.1', // IPv4-compatible
      '64:ff9b::7f00:1', // NAT64 -> 127.0.0.1
    ]) {
      expect(isUnsafeRedirectHost(host)).toBe(true);
    }
  });

  it('blocks internal hostnames', () => {
    for (const host of ['localhost', 'db.internal', 'service.local', 'foo.localhost']) {
      expect(isUnsafeRedirectHost(host)).toBe(true);
    }
  });

  it('blocks trailing-dot (FQDN root) forms that resolve identically', () => {
    for (const host of [
      'localhost.',
      'db.internal.',
      'service.local.',
      '127.0.0.1.',
      '169.254.169.254.',
    ]) {
      expect(isUnsafeRedirectHost(host)).toBe(true);
    }
  });

  it('allows public hostnames and public IPs (incl. a public IPv4-mapped IPv6)', () => {
    for (const host of [
      'kkclip.com',
      'fxtwitter.com',
      'example.com',
      '1.1.1.1',
      '8.8.8.8',
      '172.32.0.1', // just outside the 172.16/12 private block
      '::ffff:8.8.8.8', // public IPv4 mapped -> allowed
    ]) {
      expect(isUnsafeRedirectHost(host)).toBe(false);
    }
  });
});
