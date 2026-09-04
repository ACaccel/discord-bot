/**
 * Unit tests for the social-feed message builder.
 *
 * The catalog cases deliberately use the REAL on-disk translator rather
 * than a stub: the i18n gates only check that the two locale files agree
 * with each other, so nothing else in the suite would notice if the key
 * this code asks for were renamed or removed. A stubbed translator would
 * happily echo a dead key.
 */
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { SendableChannels } from 'discord.js';

import { loadCatalogResources } from '../../../../src/core/i18n/catalog-loader';
import { I18NextTranslator } from '../../../../src/core/i18n/i18next-translator';
import type { Translator } from '../../../../src/core/i18n';
import { buildFeedMessage, sendFeedPost } from '../../../../src/plugins/social-feed/internal';
import { buildFakeFeedPlatform, buildFeedPost } from '../../../fixtures/social-feed/fake-platform';
import { XPlatform } from '../../../../src/infra/social-feed';

const LOCALES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'i18n', 'locales');

const realTranslator = async (): Promise<Translator> =>
  I18NextTranslator.create(loadCatalogResources({ localesDir: LOCALES_DIR }));

const samplePost = buildFeedPost({
  id: '2092744659667673582',
  authorAccount: 'someaccount',
  createdTimestamp: 1_787_784_182,
  url: 'https://x.com/someaccount/status/2092744659667673582',
  media: [{ kind: 'photo', url: 'https://pbs.twimg.com/media/a.jpg' }],
});

const { platform: fakePlatform } = buildFakeFeedPlatform();

describe('buildFeedMessage', () => {
  it('resolves the real catalog key, leaving no placeholder behind', async () => {
    const message = buildFeedMessage(await realTranslator(), fakePlatform, samplePost);

    // A missing key makes i18next echo the key itself; an unfilled slot
    // leaves the raw {{...}} token in the output. Both must be absent.
    expect(message).not.toContain('feed.post');
    expect(message).not.toContain('{{');
  });

  it('interpolates the author, the platform, and the link the platform embeds', async () => {
    const message = buildFeedMessage(await realTranslator(), fakePlatform, samplePost);

    expect(message).toContain('someaccount');
    expect(message).toContain(fakePlatform.displayName);
    expect(message).toContain(fakePlatform.toEmbedUrl(samplePost));
  });

  it('posts the platform’s embed link rather than the canonical permalink', async () => {
    // The whole point of asking the platform: X's own host does not
    // unfurl into a playable video, the proxy host does.
    const x = new XPlatform({ timeoutMs: 1000, embedProxyHost: 'fxtwitter.com' });
    const message = buildFeedMessage(await realTranslator(), x, samplePost);

    expect(message).toContain('https://fxtwitter.com/someaccount/status/2092744659667673582');
    expect(message).not.toContain('https://x.com/');
  });

  it('does not HTML-escape the URL', async () => {
    // The catalog runs with `escapeValue: false`; if that ever flips, a
    // query-bearing URL would arrive with &amp; and break the unfurl.
    const withQuery = buildFeedPost({ ...samplePost, url: `${samplePost.url}?s=20&t=abc` });
    const x = new XPlatform({ timeoutMs: 1000, embedProxyHost: 'fxtwitter.com' });
    const message = buildFeedMessage(await realTranslator(), x, withQuery);

    expect(message).toContain('?s=20&t=abc');
    expect(message).not.toContain('&amp;');
  });
});

describe('sendFeedPost', () => {
  it('suppresses every mention, so post text cannot ping a role', async () => {
    const send = vi.fn(async () => undefined);
    const channel = { send } as unknown as SendableChannels;

    await sendFeedPost(channel, 'hello @everyone');

    expect(send).toHaveBeenCalledWith({
      content: 'hello @everyone',
      allowedMentions: { parse: [] },
    });
  });
});
