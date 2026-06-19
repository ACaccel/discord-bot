/**
 * Bilibili provider. Rewrites a video URL onto an embed-proxy domain
 * (defaults `vxbilibili.com` → `bilibiliez.com`) so Discord renders a
 * playable video / rich embed. Each candidate host is validated (OG probe)
 * before being posted. Only original bilibili video hosts match — proxy
 * hosts are excluded so an already-fixed link the user posted is left
 * untouched.
 *
 * Proxy services: BiliFix (`vxbilibili.com`) and BilibiliEZ
 * (`bilibiliez.com`) both fix bilibili embeds by a plain host-swap, exactly
 * like fxtwitter/vxtwitter for Twitter.
 *
 * Scope is bilibili.com video pages (`/video/<BV…|av…>`) plus `b23.tv` short
 * links that resolve to one. A `b23.tv` token carries no video id, so — like
 * the Facebook share-link path — it is first expanded to its canonical
 * permalink via {@link OgClient.resolveCanonical} (a browser-UA redirect
 * chase) and only proxied when the resolved URL is a bilibili video page;
 * anything else (live / dynamic / article / bangumi, or a failed resolution)
 * is skipped silently. The `?p=` page selector (which part of a multi-part
 * video) is meaningful, so it is preserved while every other query param
 * (bilibili tracking such as `spm_id_from` / `vd_source`) is dropped — the
 * proxy needs only the path and the part index.
 *
 * The trailing slash is stripped from the path: vxbilibili answers a
 * `/video/<BV>/` request with a 307 that DOWNGRADES to `http://…/video/<BV>`
 * (no slash), and Discord's crawler refuses an https→http downgrade, so the
 * embed never renders. Posting the canonical no-slash URL is served 200
 * directly, so Discord unfurls it. (Our own probe followed the 307 and so
 * masked the failure.)
 */
import { ok } from '../../../core/result';

import { createRewriteProvider } from './rewrite-provider';
import type { OgClient } from '../og-client';
import type { LinkPreviewBuildContext, LinkPreviewProvider } from '../types';

const PROVIDER_NAME = 'bilibili';

const BILIBILI_HOSTS: ReadonlySet<string> = new Set([
  'bilibili.com',
  'www.bilibili.com',
  'm.bilibili.com',
]);

/** Bilibili official short-link hosts (resolve via redirect; carry no video id). */
const B23_HOSTS: ReadonlySet<string> = new Set(['b23.tv', 'www.b23.tv']);

/** `/video/<BV…>` or `/video/av<digits>` — rejects spaces/bangumi/live/home. */
const VIDEO_PATH = /^\/video\/(?:BV[0-9A-Za-z]+|av\d+)/;

/** A direct bilibili video page URL (right host + `/video/<BV|av>` path). */
const isBilibiliVideoUrl = (url: URL): boolean =>
  BILIBILI_HOSTS.has(url.hostname.toLowerCase()) && VIDEO_PATH.test(url.pathname);

/** A `b23.tv` short link whose opaque token must be resolved before proxying. */
const isB23ShortLink = (url: URL): boolean => B23_HOSTS.has(url.hostname.toLowerCase());

/** Re-append only the meaningful `?p=` part selector, dropping tracking query. */
const pageQuery = (url: URL): string => {
  const page = url.searchParams.get('p');
  return page !== null && page.length > 0 ? `?p=${encodeURIComponent(page)}` : '';
};

const matches = (url: URL): boolean => isBilibiliVideoUrl(url) || isB23ShortLink(url);

/**
 * Expand a `b23.tv` short link to its canonical bilibili video URL so the
 * proxy probe runs against a previewable page. Returns the canonical URL, or
 * `undefined` when resolution fails or does not land on a bilibili video page
 * (the caller then skips the link silently).
 */
const resolveB23 = async (
  url: URL,
  ctx: LinkPreviewBuildContext,
  ogClient: OgClient,
): Promise<URL | undefined> => {
  const resolved = await ogClient.resolveCanonical(url.href, ctx.timeoutMs, PROVIDER_NAME);
  if (!resolved.ok) {
    ctx.logger?.debug(
      { provider: PROVIDER_NAME, code: resolved.error.code },
      'social-link-preview: bilibili b23.tv resolution failed, skipping',
    );
    return undefined;
  }
  let canonical: URL;
  try {
    canonical = new URL(resolved.value);
  } catch {
    return undefined;
  }
  // Only trust a resolution that lands on a real bilibili video page — not
  // another short-link hop, a live/dynamic/article/bangumi page, or off-site
  // host. This is also the SSRF re-check on the redirect destination.
  // `pageQuery` keeps only `?p=`, so the resolved query needs no pre-cleaning.
  if (!isBilibiliVideoUrl(canonical)) return undefined;
  return canonical;
};

export const createBilibiliProvider = (opts: {
  proxyHosts: readonly string[];
  ogClient: OgClient;
}): LinkPreviewProvider => {
  // Reuse the generic probe/validate machinery for the canonical video URL.
  const rewrite = createRewriteProvider({
    name: PROVIDER_NAME,
    matches: isBilibiliVideoUrl,
    proxyHosts: opts.proxyHosts,
    ogClient: opts.ogClient,
    toProxyUrl: (url, host) =>
      `https://${host}${url.pathname.replace(/\/+$/, '')}${pageQuery(url)}`,
  });

  return {
    name: PROVIDER_NAME,
    canHandle: matches,
    build: async (url, ctx) => {
      if (isB23ShortLink(url)) {
        const canonical = await resolveB23(url, ctx, opts.ogClient);
        if (canonical === undefined) return ok(null); // skip silently
        const probe = await rewrite.build(canonical, ctx);
        if (!probe.ok) return probe;
        if (probe.value === null) return ok(null);
        // Carry the original short link as sourceUrl (logging / de-dup), not
        // the intermediate canonical we resolved to.
        return ok({ ...probe.value, sourceUrl: url.href });
      }
      return rewrite.build(url, ctx);
    },
  };
};
