/**
 * Facebook provider. Rewrites a post / video / reel URL onto an
 * embed-proxy domain (defaults `facebed.com` -> `fixacebook.com`) so Discord
 * renders a richer embed. Each candidate is validated before posting.
 *
 * `facebed.com` is primary because it covers text / photo / album posts as
 * well as video; `fixacebook.com` is a video/reel-only fallback. The earlier
 * default `facebookez.com` was dropped — it became defunct and now redirects
 * to an ad network.
 *
 * Two Facebook-specific wrinkles this provider handles on top of the generic
 * rewrite template:
 *
 *   1. Share short links (`/share/<type>/<token>/`, e.g. `/share/r/<token>`)
 *      carry an opaque share token, NOT a content id, so the embed proxies
 *      cannot resolve them and serve a login wall instead. We first expand
 *      the share link to its canonical permalink via
 *      {@link OgClient.resolveCanonical} (a browser-UA redirect chase) and
 *      probe the proxies with THAT — the only form that yields a playable
 *      video.
 *   2. When no proxy can preview a Facebook link (the probe returns `null`),
 *      we fall back to a static card built from Facebook's OWN OpenGraph,
 *      which Facebook reliably serves to the Discord crawler UA (title /
 *      description / thumbnail). A login-wall / removed-post placeholder is
 *      rejected (same junk filter) so a broken card is never posted.
 *
 * Unlike the other rewrite providers, the query string is preserved for the
 * proxy probe — several Facebook permalink shapes (`/watch/?v=`,
 * `permalink.php`, `story.php`) carry the post id in the query, not the path.
 */
import { ok, type Result } from '../../../core/result';

import { createRewriteProvider, isJunkPreview } from './rewrite-provider';
import type { OgClient } from '../og-client';
import type {
  LinkPreviewBuildContext,
  LinkPreviewFailure,
  LinkPreviewProvider,
  LinkPreviewResult,
} from '../types';

const PROVIDER_NAME = 'facebook';
/** Human-readable label for the embed footer of a fallback card. */
const SITE_LABEL = 'Facebook';

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

/** A `facebook.com/share/<type>/<token>` short link that proxies cannot resolve. */
const isShareLink = (url: URL): boolean =>
  FACEBOOK_HOSTS.has(url.hostname.toLowerCase()) && /^\/share\//i.test(url.pathname);

/** Build the candidate proxy URL for one host. Keep the query (FB ids live there). */
const toProxyUrl = (url: URL, host: string): string =>
  `https://${host}${url.pathname}${url.search}`;

/**
 * Expand a Facebook share short link to its canonical permalink so the proxy
 * probe runs against a previewable URL. Returns the canonical URL, or
 * `undefined` when resolution fails or does not reach a real content
 * permalink (the caller then probes the original and/or falls back to a card).
 */
const resolveShareLink = async (
  url: URL,
  ctx: LinkPreviewBuildContext,
  ogClient: OgClient,
): Promise<URL | undefined> => {
  const resolved = await ogClient.resolveCanonical(url.href, ctx.timeoutMs, PROVIDER_NAME);
  if (!resolved.ok) {
    ctx.logger?.debug(
      { provider: PROVIDER_NAME, code: resolved.error.code },
      'social-link-preview: facebook share-link resolution failed, falling back',
    );
    return undefined;
  }
  let canonical: URL;
  try {
    canonical = new URL(resolved.value);
  } catch {
    return undefined;
  }
  // Only trust a resolution that lands on a real Facebook content permalink
  // (not another /share/ hop, a profile, or an off-site host).
  if (!FACEBOOK_HOSTS.has(canonical.hostname.toLowerCase())) return undefined;
  if (isShareLink(canonical) || !POST_PATH.test(canonical.pathname)) return undefined;
  // The resolved id lives in the path; the redirect's `share_url` / `rdid`
  // query is attribution noise that can only confuse the proxy.
  canonical.search = '';
  return canonical;
};

/**
 * Fallback when no proxy can preview the link: scrape Facebook's own
 * OpenGraph (served to the Discord crawler UA) and return a static card.
 * Skips gated / removed placeholders and imageless pages so a broken or
 * text-only card is never posted.
 */
const buildFacebookCard = async (
  url: URL,
  ctx: LinkPreviewBuildContext,
  ogClient: OgClient,
): Promise<Result<LinkPreviewResult | null, LinkPreviewFailure>> => {
  const result = await ogClient.fetch(url.href, PROVIDER_NAME, ctx.timeoutMs);
  if (!result.ok) return result;

  const og = result.value;
  const image = og.images[0];
  // A login wall / removed post (junk) or an imageless page is not worth a card.
  if (isJunkPreview(og) || image === undefined) return ok(null);

  return ok({
    kind: 'card',
    card: {
      url: og.url ?? url.href,
      title: og.title,
      description: og.description,
      imageUrl: image,
      siteName: og.siteName ?? SITE_LABEL,
    },
    sourceUrl: url.href,
  });
};

export const createFacebookProvider = (opts: {
  proxyHosts: readonly string[];
  ogClient: OgClient;
}): LinkPreviewProvider => {
  // Reuse the generic probe/validate machinery for the canonical URL.
  const rewrite = createRewriteProvider({
    name: PROVIDER_NAME,
    matches,
    proxyHosts: opts.proxyHosts,
    ogClient: opts.ogClient,
    toProxyUrl,
  });

  return {
    name: PROVIDER_NAME,
    canHandle: matches,
    build: async (url, ctx) => {
      // Expand a share short link before probing; otherwise probe as-is.
      const base = isShareLink(url)
        ? ((await resolveShareLink(url, ctx, opts.ogClient)) ?? url)
        : url;

      const probe = await rewrite.build(base, ctx);
      if (!probe.ok) return probe;
      if (probe.value !== null) {
        // Carry the original link as sourceUrl (logging / de-dup), not the
        // intermediate canonical we resolved to.
        return ok({ ...probe.value, sourceUrl: url.href });
      }
      // No proxy could preview it — fall back to Facebook's own OpenGraph card.
      return buildFacebookCard(url, ctx, opts.ogClient);
    },
  };
};
