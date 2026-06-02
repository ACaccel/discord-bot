/**
 * Unit tests for {@link LinkPreviewProviderRegistry} (first-match-wins by
 * registration order) and {@link createDefaultLinkPreviewRegistry}
 * (per-platform routing, the `enabledProviders` kill-switch, and proxy
 * host-list overrides). Routing uses only the pure `canHandle`; the
 * override test injects a fake `OgClient` so it stays offline.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  LinkPreviewProviderRegistry,
  createDefaultLinkPreviewRegistry,
  type LinkPreviewProvider,
  type OgClient,
  type OpenGraphMeta,
} from '../../../../src/infra/link-preview';
import { ok } from '../../../../src/core/result';

const u = (href: string): URL => new URL(href);

const stubProvider = (
  name: LinkPreviewProvider['name'],
  matches: (url: URL) => boolean,
): LinkPreviewProvider => ({
  name,
  canHandle: matches,
  build: () => Promise.resolve(ok(null)),
});

describe('LinkPreviewProviderRegistry.findProvider', () => {
  it('returns the first provider whose canHandle matches (registration order = priority)', () => {
    const first = stubProvider('twitter', () => true);
    const second = stubProvider('bahamut', () => true);
    const registry = new LinkPreviewProviderRegistry([first, second]);
    expect(registry.findProvider(u('https://anything/x'))).toBe(first);
  });

  it('returns undefined when no provider matches', () => {
    const registry = new LinkPreviewProviderRegistry([stubProvider('twitter', () => false)]);
    expect(registry.findProvider(u('https://anything/x'))).toBeUndefined();
  });
});

describe('createDefaultLinkPreviewRegistry', () => {
  it('routes each platform URL to its provider', () => {
    const registry = createDefaultLinkPreviewRegistry();
    expect(registry.findProvider(u('https://x.com/a/status/1'))?.name).toBe('twitter');
    expect(registry.findProvider(u('https://www.instagram.com/p/abc/'))?.name).toBe('instagram');
    expect(registry.findProvider(u('https://www.threads.net/@a/post/1'))?.name).toBe('threads');
    expect(registry.findProvider(u('https://www.facebook.com/a/posts/1'))?.name).toBe('facebook');
    expect(registry.findProvider(u('https://forum.gamer.com.tw/C.php?bsn=1'))?.name).toBe(
      'bahamut',
    );
  });

  it('honours the enabledProviders allow-list', () => {
    const registry = createDefaultLinkPreviewRegistry({ enabledProviders: ['twitter'] });
    expect(registry.findProvider(u('https://x.com/a/status/1'))?.name).toBe('twitter');
    expect(registry.findProvider(u('https://forum.gamer.com.tw/C.php?bsn=1'))).toBeUndefined();
  });

  it('applies a custom proxy-host list (validated offline via injected OgClient)', async () => {
    const candidate = 'https://vxtwitter.com/a/status/1';
    const fetch = vi.fn(async (url: string) =>
      ok((url === candidate ? { images: [], video: 'v.mp4' } : { images: [] }) as OpenGraphMeta),
    );
    const ogClient = { fetch } as unknown as OgClient;
    const registry = createDefaultLinkPreviewRegistry({
      twitterProxyHosts: ['vxtwitter.com'],
      ogClient,
    });
    const provider = registry.findProvider(u('https://x.com/a/status/1'));
    const result = await provider?.build(u('https://x.com/a/status/1'), { timeoutMs: 1000 });
    if (result?.ok === true && result.value?.kind === 'rewritten-url') {
      expect(result.value.url).toBe(candidate);
    } else {
      throw new Error('expected a rewritten-url result');
    }
  });
});
