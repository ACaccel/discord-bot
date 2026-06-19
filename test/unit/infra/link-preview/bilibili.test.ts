/**
 * Unit tests for the Bilibili link-preview provider: host/path matching
 * (BV + av video ids across www/m/apex, rejecting non-video pages and proxy
 * hosts) and proxy-URL construction (host-swap, `?p=` part selector
 * preserved, every other tracking query param dropped). The probe loop
 * itself is contract-tested via the shared rewrite-provider (Twitter stands
 * in); here an injected fake `OgClient` keeps the test offline and lets it
 * assert the exact candidate URL that gets probed.
 */
import { describe, expect, it, vi } from 'vitest';

import { createBilibiliProvider } from '../../../../src/infra/link-preview';
import { ok } from '../../../../src/core/result';
import type { OgClient, OpenGraphMeta } from '../../../../src/infra/link-preview';

const u = (href: string): URL => new URL(href);

const provider = (ogClient: OgClient): ReturnType<typeof createBilibiliProvider> =>
  createBilibiliProvider({ proxyHosts: ['vxbilibili.com', 'bilibiliez.com'], ogClient });

/** Capture the candidate URLs the provider probes, always answering with a video hit. */
const recordingClient = (seen: string[]): OgClient =>
  ({
    fetch: vi.fn(async (url: string) => {
      seen.push(url);
      return ok({ images: [], video: 'v.mp4' } as OpenGraphMeta);
    }),
  }) as unknown as OgClient;

describe('createBilibiliProvider.canHandle', () => {
  const p = provider({ fetch: vi.fn() } as unknown as OgClient);

  it('accepts BV and av video pages on www / m / apex hosts', () => {
    expect(p.canHandle(u('https://www.bilibili.com/video/BV1xx411c7mD'))).toBe(true);
    expect(p.canHandle(u('https://m.bilibili.com/video/BV1xx411c7mD'))).toBe(true);
    expect(p.canHandle(u('https://bilibili.com/video/av170001'))).toBe(true);
    expect(p.canHandle(u('https://www.bilibili.com/video/BV1xx411c7mD?p=2&spm_id_from=x'))).toBe(
      true,
    );
  });

  it('rejects non-video pages, short links, and proxy hosts', () => {
    expect(p.canHandle(u('https://www.bilibili.com/'))).toBe(false);
    expect(p.canHandle(u('https://space.bilibili.com/123'))).toBe(false);
    expect(p.canHandle(u('https://www.bilibili.com/bangumi/play/ep123'))).toBe(false);
    expect(p.canHandle(u('https://live.bilibili.com/123'))).toBe(false);
    expect(p.canHandle(u('https://b23.tv/abcdef'))).toBe(false);
    // An already-fixed proxy link must be left alone (no re-rewrite loop).
    expect(p.canHandle(u('https://vxbilibili.com/video/BV1xx411c7mD'))).toBe(false);
  });
});

describe('createBilibiliProvider.build proxy URL', () => {
  it('host-swaps to the first proxy, preserving ?p= and dropping tracking query', async () => {
    const seen: string[] = [];
    const result = await provider(recordingClient(seen)).build(
      u('https://www.bilibili.com/video/BV1xx411c7mD?p=2&spm_id_from=333&vd_source=abc'),
      { timeoutMs: 1000, budgetMs: 8000 },
    );

    expect(seen[0]).toBe('https://vxbilibili.com/video/BV1xx411c7mD?p=2');
    if (result.ok && result.value?.kind === 'rewritten-url') {
      expect(result.value.url).toBe('https://vxbilibili.com/video/BV1xx411c7mD?p=2');
    } else {
      throw new Error('expected a rewritten-url result');
    }
  });

  it('drops the query entirely when no ?p= part selector is present', async () => {
    const seen: string[] = [];
    await provider(recordingClient(seen)).build(
      u('https://m.bilibili.com/video/BV1xx411c7mD?spm_id_from=333'),
      { timeoutMs: 1000, budgetMs: 8000 },
    );

    expect(seen[0]).toBe('https://vxbilibili.com/video/BV1xx411c7mD');
  });

  it('strips a trailing slash so the proxy URL is not 307-downgraded by vxbilibili', async () => {
    // vxbilibili answers `/video/<BV>/` with a 307 that downgrades to http://;
    // Discord refuses the https->http downgrade, so the canonical no-slash URL
    // must be posted instead.
    const seen: string[] = [];
    await provider(recordingClient(seen)).build(u('https://www.bilibili.com/video/BV1xx411c7mD/'), {
      timeoutMs: 1000,
      budgetMs: 8000,
    });

    expect(seen[0]).toBe('https://vxbilibili.com/video/BV1xx411c7mD');
  });

  it('strips the trailing slash while keeping the ?p= selector', async () => {
    const seen: string[] = [];
    await provider(recordingClient(seen)).build(
      u('https://www.bilibili.com/video/BV1xx411c7mD/?p=2'),
      { timeoutMs: 1000, budgetMs: 8000 },
    );

    expect(seen[0]).toBe('https://vxbilibili.com/video/BV1xx411c7mD?p=2');
  });
});
