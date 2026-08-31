/**
 * Unit tests for the x-media-feed message builder.
 *
 * The catalog cases deliberately use the REAL on-disk translator rather
 * than a stub: the i18n gates only check that the two locale files agree
 * with each other, so nothing else in the suite would notice if the key
 * this code asks for were renamed or removed. A stubbed translator would
 * happily echo a dead key.
 */
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCatalogResources } from '../../../../src/core/i18n/catalog-loader';
import { I18NextTranslator } from '../../../../src/core/i18n/i18next-translator';
import type { Translator } from '../../../../src/core/i18n';
import { buildFeedMessage, toEmbedProxyUrl } from '../../../../src/plugins/x-media-feed/internal';
import type { XPost } from '../../../../src/infra/x-feed';

const LOCALES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'i18n', 'locales');

const realTranslator = async (): Promise<Translator> =>
  I18NextTranslator.create(loadCatalogResources({ localesDir: LOCALES_DIR }));

const samplePost: XPost = {
  id: '2092744659667673582',
  authorHandle: 'someaccount',
  createdTimestamp: 1_787_784_182,
  url: 'https://x.com/someaccount/status/2092744659667673582',
  isReply: false,
  isRepost: false,
  media: [{ kind: 'photo', url: 'https://pbs.twimg.com/media/a.jpg' }],
};

describe('toEmbedProxyUrl', () => {
  it('swaps the host and preserves the path', () => {
    expect(toEmbedProxyUrl(samplePost.url, 'fxtwitter.com')).toBe(
      'https://fxtwitter.com/someaccount/status/2092744659667673582',
    );
  });

  it('keeps the https scheme', () => {
    expect(toEmbedProxyUrl(samplePost.url, 'fxtwitter.com').startsWith('https://')).toBe(true);
  });

  it('returns the original string when the URL cannot be parsed', () => {
    expect(toEmbedProxyUrl('not a url', 'fxtwitter.com')).toBe('not a url');
  });

  it('leaves the original host in place when the configured host is not a valid hostname', () => {
    // The WHATWG URL setter silently ignores an invalid hostname, which is
    // the safe direction: a misconfigured proxy posts the real permalink
    // rather than a mangled or attacker-shaped link.
    const result = toEmbedProxyUrl(samplePost.url, 'not a host');
    expect(result).toContain('x.com');
    expect(result).not.toContain('not a host');
  });

  it('cannot be used to graft a path onto the link', () => {
    const result = toEmbedProxyUrl(samplePost.url, 'evil.example/attack');
    expect(result).not.toContain('/attack');
  });
});

describe('buildFeedMessage', () => {
  it('resolves the real catalog key, leaving no placeholder behind', async () => {
    const message = buildFeedMessage(await realTranslator(), samplePost, 'fxtwitter.com');

    // A missing key makes i18next echo the key itself; an unfilled slot
    // leaves the raw {{...}} token in the output. Both must be absent.
    expect(message).not.toContain('x_media_feed.post');
    expect(message).not.toContain('{{');
  });

  it('interpolates the author and the proxied link', async () => {
    const message = buildFeedMessage(await realTranslator(), samplePost, 'fxtwitter.com');

    expect(message).toContain('someaccount');
    expect(message).toContain('https://fxtwitter.com/someaccount/status/2092744659667673582');
  });

  it('does not HTML-escape the URL', async () => {
    // The catalog runs with `escapeValue: false`; if that ever flips, a
    // query-bearing URL would arrive with &amp; and break the unfurl.
    const withQuery: XPost = { ...samplePost, url: `${samplePost.url}?s=20&t=abc` };
    const message = buildFeedMessage(await realTranslator(), withQuery, 'fxtwitter.com');

    expect(message).toContain('?s=20&t=abc');
    expect(message).not.toContain('&amp;');
  });
});
