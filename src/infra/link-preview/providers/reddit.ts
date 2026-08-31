/**
 * Reddit provider. Rewrites a post URL onto one of the operator's configured
 * embed-proxy domains so Discord renders a playable video / rich
 * embed. Reddit videos live on `v.redd.it` and Discord does not unfurl them
 * natively, so the proxy (which serves the post's OpenGraph / Twitter-card
 * via Reddit's API) is the only path to a real preview.
 *
 * Every Reddit proxy is subject to Reddit's API restrictions and degrades by
 * serving an error placeholder rather than by failing outright, so the
 * per-host validation is what keeps a broken card off the channel (see
 * `scoreMeta` / `isJunkPreviewTitle`). Matches comment permalinks
 * (`/r/<sub>/comments/<id>`, the bare `/comments/<id>`) and the mobile
 * share form (`/r/<sub>/s/<token>`); bare subreddit / profile URLs are
 * rejected.
 */
import { createRewriteProvider } from './rewrite-provider';
import type { OgClient } from '../og-client';
import type { LinkPreviewProvider } from '../types';

const REDDIT_HOSTS: ReadonlySet<string> = new Set([
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'new.reddit.com',
  'np.reddit.com',
  'm.reddit.com',
  'amp.reddit.com',
]);

/** `/comments/<id>` (with or without `/r/<sub>`) or a `/r/<sub>/s/<token>` share link. */
const POST_PATH = /\/comments\/[a-z0-9]+|\/r\/[^/]+\/s\/[a-z0-9]+/i;

export const createRedditProvider = (opts: {
  proxyHosts: readonly string[];
  ogClient: OgClient;
}): LinkPreviewProvider =>
  createRewriteProvider({
    name: 'reddit',
    matches: (url) => REDDIT_HOSTS.has(url.hostname.toLowerCase()) && POST_PATH.test(url.pathname),
    proxyHosts: opts.proxyHosts,
    ogClient: opts.ogClient,
    // Drop the query (Reddit share links carry only tracking params); the proxy needs only the path.
    toProxyUrl: (url, host) => `https://${host}${url.pathname}`,
  });
