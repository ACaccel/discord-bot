/**
 * Facebook provider. Rewrites a post / video / reel URL onto an
 * embed-proxy domain (defaults `facebed.com` → `fixacebook.com`) so Discord
 * renders a richer embed. Each candidate is validated before posting.
 *
 * `facebed.com` is primary because it covers text / photo / album posts as
 * well as video; `fixacebook.com` is a video/reel-only fallback. The earlier
 * default `facebookez.com` was dropped — it became defunct and now redirects
 * to an ad network. Note that `fb.watch/<id>` short links may not resolve on
 * every proxy — full `facebook.com/share/v/...` links are the reliable form.
 *
 * Unlike the other rewrite providers, the query string is preserved —
 * several Facebook permalink shapes (`/watch/?v=`, `permalink.php`,
 * `story.php`) carry the post id in the query, not the path.
 */
import { createRewriteProvider } from './rewrite-provider';
import type { OgClient } from '../og-client';
import type { LinkPreviewProvider } from '../types';

const FACEBOOK_HOSTS: ReadonlySet<string> = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
]);

/** Path shapes that carry a previewable post/video/reel. */
const POST_PATH = /\/(?:posts|videos|reel|reels|share|watch|permalink\.php|story\.php)\b/i;

/** `fb.watch` short links are always a single video, regardless of path. */
const isFbWatch = (host: string): boolean => host === 'fb.watch' || host === 'www.fb.watch';

const matches = (url: URL): boolean => {
  const host = url.hostname.toLowerCase();
  if (isFbWatch(host)) return true;
  return FACEBOOK_HOSTS.has(host) && POST_PATH.test(url.pathname);
};

export const createFacebookProvider = (opts: {
  proxyHosts: readonly string[];
  ogClient: OgClient;
}): LinkPreviewProvider =>
  createRewriteProvider({
    name: 'facebook',
    matches,
    proxyHosts: opts.proxyHosts,
    ogClient: opts.ogClient,
    // Preserve the query string: several FB shapes carry the id there.
    toProxyUrl: (url, host) => `https://${host}${url.pathname}${url.search}`,
  });
