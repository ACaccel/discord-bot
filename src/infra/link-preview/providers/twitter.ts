/**
 * Twitter / X provider. Rewrites a tweet URL onto an embed-proxy domain
 * (defaults `fxtwitter.com` → `vxtwitter.com`) so Discord renders a playable
 * video / rich embed. Each candidate host is validated (OG probe) before
 * being posted. Only original tweet hosts match — proxy hosts are excluded
 * so an already-fixed link the user posted is left untouched.
 */
import { createRewriteProvider } from './rewrite-provider';
import type { OgClient } from '../og-client';
import type { LinkPreviewProvider } from '../types';

const TWITTER_HOSTS: ReadonlySet<string> = new Set([
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'x.com',
  'www.x.com',
  'mobile.x.com',
]);

/** `/<user>/status/<id>` or `/i/web/status/<id>` — rejects profiles/search. */
const STATUS_PATH = /\/status(?:es)?\/\d+/;

export const createTwitterProvider = (opts: {
  proxyHosts: readonly string[];
  ogClient: OgClient;
}): LinkPreviewProvider =>
  createRewriteProvider({
    name: 'twitter',
    matches: (url) =>
      TWITTER_HOSTS.has(url.hostname.toLowerCase()) && STATUS_PATH.test(url.pathname),
    proxyHosts: opts.proxyHosts,
    ogClient: opts.ogClient,
    // Drop the query string (usually tracking params); the proxy needs only the path.
    toProxyUrl: (url, host) => `https://${host}${url.pathname}`,
  });
