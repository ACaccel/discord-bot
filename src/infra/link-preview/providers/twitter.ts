/**
 * Twitter / X provider. Rewrites a tweet URL onto one of the operator's
 * configured embed-proxy domains so Discord renders a playable video / rich
 * embed. Each candidate host is validated (OG probe) before being posted.
 * Only original tweet hosts match — proxy hosts are excluded so an
 * already-fixed link the user posted is left untouched.
 *
 * Host order matters more here than for the other sources: the FxEmbed
 * family (`fxtwitter.com` and its aliases) publishes media through an
 * `application/activity+json` alternate link rather than OpenGraph, so the
 * validation probe sees no `og:video` and grades a video tweet text-tier. A
 * host that does serve `og:video` therefore belongs ahead of it, or every
 * video scores as a bare title.
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
