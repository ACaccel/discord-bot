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
 * Scope is bilibili.com video pages only (`/video/<BV…|av…>`), mirroring the
 * Twitter provider's `/status/`-only scope; short links (`b23.tv`) are out of
 * scope, as `t.co` is for Twitter. Unlike Twitter, the `?p=` page selector
 * (which part of a multi-part video) is meaningful, so it is preserved while
 * every other query param (bilibili tracking such as `spm_id_from` /
 * `vd_source`) is dropped — the proxy needs only the path and the part index.
 *
 * The trailing slash is stripped from the path: vxbilibili answers a
 * `/video/<BV>/` request with a 307 that DOWNGRADES to `http://…/video/<BV>`
 * (no slash), and Discord's crawler refuses an https→http downgrade, so the
 * embed never renders. Posting the canonical no-slash URL is served 200
 * directly, so Discord unfurls it. (Our own probe followed the 307 and so
 * masked the failure.)
 */
import { createRewriteProvider } from './rewrite-provider';
import type { OgClient } from '../og-client';
import type { LinkPreviewProvider } from '../types';

const BILIBILI_HOSTS: ReadonlySet<string> = new Set([
  'bilibili.com',
  'www.bilibili.com',
  'm.bilibili.com',
]);

/** `/video/<BV…>` or `/video/av<digits>` — rejects spaces/bangumi/live/home. */
const VIDEO_PATH = /^\/video\/(?:BV[0-9A-Za-z]+|av\d+)/;

/** Re-append only the meaningful `?p=` part selector, dropping tracking query. */
const pageQuery = (url: URL): string => {
  const page = url.searchParams.get('p');
  return page !== null && page.length > 0 ? `?p=${encodeURIComponent(page)}` : '';
};

export const createBilibiliProvider = (opts: {
  proxyHosts: readonly string[];
  ogClient: OgClient;
}): LinkPreviewProvider =>
  createRewriteProvider({
    name: 'bilibili',
    matches: (url) =>
      BILIBILI_HOSTS.has(url.hostname.toLowerCase()) && VIDEO_PATH.test(url.pathname),
    proxyHosts: opts.proxyHosts,
    ogClient: opts.ogClient,
    toProxyUrl: (url, host) =>
      `https://${host}${url.pathname.replace(/\/+$/, '')}${pageQuery(url)}`,
  });
