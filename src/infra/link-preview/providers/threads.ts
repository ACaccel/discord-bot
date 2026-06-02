/**
 * Threads provider. Rewrites a post URL onto an embed-proxy domain
 * (defaults `viewthreads.com` → `vxthreads.net`) so Discord renders an
 * embed. Matches both the legacy `threads.net` and current `threads.com`
 * hosts.
 *
 * Threads is the least reliable platform for embeds: `fixthreads.net` was
 * archived (2026-02), `threadsez.com` now 307s to an `embedez.com` JSON
 * download API that never serves OpenGraph, and `vxthreads.net` has been
 * intermittently unreachable — so the verified-working `viewthreads.com`
 * leads the default list and `vxthreads.net` trails as a fallback. The
 * priority list + per-host validation tries each until one yields media;
 * if all fail, nothing is posted (no bare link).
 */
import { createRewriteProvider } from './rewrite-provider';
import type { OgClient } from '../og-client';
import type { LinkPreviewProvider } from '../types';

const THREADS_HOSTS: ReadonlySet<string> = new Set([
  'threads.net',
  'www.threads.net',
  'threads.com',
  'www.threads.com',
]);

/** `/@user/post/<id>` or `/t/<id>` — rejects profiles. */
const POST_PATH = /\/(?:post|t)\/[A-Za-z0-9._-]+/;

export const createThreadsProvider = (opts: {
  proxyHosts: readonly string[];
  ogClient: OgClient;
}): LinkPreviewProvider =>
  createRewriteProvider({
    name: 'threads',
    matches: (url) => THREADS_HOSTS.has(url.hostname.toLowerCase()) && POST_PATH.test(url.pathname),
    proxyHosts: opts.proxyHosts,
    ogClient: opts.ogClient,
    toProxyUrl: (url, host) => `https://${host}${url.pathname}`,
  });
