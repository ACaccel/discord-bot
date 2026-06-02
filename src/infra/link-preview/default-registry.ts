/**
 * Default {@link LinkPreviewProviderRegistry} wired with every production
 * provider, in priority order. Built via {@link createDefaultLinkPreviewRegistry}
 * so a test can construct its own partial registry without the real
 * providers.
 *
 * Proxy domains are third-party embed-fix services and are
 * operator-overridable (see the plugin config) because their uptime and
 * policies change over time. `enabledProviders` is the kill-switch: a
 * subset allow-list (from `config.providers`) drops any source whose
 * proxy is misbehaving.
 *
 * Adding a new provider:
 *   1. Implement {@link LinkPreviewProvider} (or reuse `createRewriteProvider`).
 *   2. Append its name to {@link LinkPreviewProviderName} in `./types`.
 *   3. Add one line to the `all` array below.
 */
import { OgClient } from './og-client';
import { LinkPreviewProviderRegistry } from './registry';
import { createBahamutProvider } from './providers/bahamut';
import { createFacebookProvider } from './providers/facebook';
import { createInstagramProvider } from './providers/instagram';
import { createThreadsProvider } from './providers/threads';
import { createTwitterProvider } from './providers/twitter';
import type { LinkPreviewProvider, LinkPreviewProviderName } from './types';

/**
 * Built-in default proxy-host priority lists, keyed by every provider except
 * `bahamut` (which has no proxy and scrapes OpenGraph instead). Deriving the
 * key type from {@link LinkPreviewProviderName} means adding a rewrite
 * provider forces a default-list entry here. Each list is probed in order
 * and validated before posting (see `rewrite-provider.ts`). Overridable per
 * source via {@link LinkPreviewRegistryDeps}.
 */
export const DEFAULT_PROXY_HOSTS: Readonly<
  Record<Exclude<LinkPreviewProviderName, 'bahamut'>, readonly string[]>
> = {
  twitter: ['fxtwitter.com', 'vxtwitter.com'],
  instagram: ['kkinstagram.com', 'uuinstagram.com'],
  threads: ['viewthreads.com', 'vxthreads.net'],
  facebook: ['facebed.com', 'fixacebook.com'],
};

/** Default OG-cache TTL for the shared fetcher (avoids hammering flaky proxies). */
const DEFAULT_OG_CACHE_TTL_MS = 10 * 60 * 1000;

export interface LinkPreviewRegistryDeps {
  /** OpenGraph fetcher shared by validation + Bahamut; defaults to a cached {@link OgClient}. */
  readonly ogClient?: OgClient;
  readonly twitterProxyHosts?: readonly string[];
  readonly instagramProxyHosts?: readonly string[];
  readonly threadsProxyHosts?: readonly string[];
  readonly facebookProxyHosts?: readonly string[];
  /** When set, only these providers are registered (the kill-switch allow-list). */
  readonly enabledProviders?: readonly LinkPreviewProviderName[];
}

export const createDefaultLinkPreviewRegistry = (
  deps: LinkPreviewRegistryDeps = {},
): LinkPreviewProviderRegistry => {
  const ogClient = deps.ogClient ?? new OgClient({ cacheTtlMs: DEFAULT_OG_CACHE_TTL_MS });
  const all: readonly LinkPreviewProvider[] = [
    createTwitterProvider({
      proxyHosts: deps.twitterProxyHosts ?? DEFAULT_PROXY_HOSTS.twitter,
      ogClient,
    }),
    createInstagramProvider({
      proxyHosts: deps.instagramProxyHosts ?? DEFAULT_PROXY_HOSTS.instagram,
      ogClient,
    }),
    createThreadsProvider({
      proxyHosts: deps.threadsProxyHosts ?? DEFAULT_PROXY_HOSTS.threads,
      ogClient,
    }),
    createFacebookProvider({
      proxyHosts: deps.facebookProxyHosts ?? DEFAULT_PROXY_HOSTS.facebook,
      ogClient,
    }),
    createBahamutProvider(ogClient),
  ];
  const allow = deps.enabledProviders;
  const providers = allow === undefined ? all : all.filter((p) => allow.includes(p.name));
  return new LinkPreviewProviderRegistry(providers);
};
