/**
 * `infra/link-preview` barrel.
 *
 * The link-preview Strategy lives in the infra layer because every
 * member here is an outbound boundary: the rewrite providers map a post
 * URL onto a third-party embed-proxy domain, the Bahamut provider scrapes
 * OpenGraph via the SSRF-safe `OgClient`, and `error-translator` maps
 * HTTP failures into the shared domain taxonomy. Discord-specific
 * assembly (embeds, replies, suppression) belongs to the consuming
 * `src/plugins/social-link-preview/` plugin.
 */
export type {
  LinkPreviewProvider,
  LinkPreviewProviderName,
  LinkPreviewResult,
  LinkPreviewBuildContext,
  LinkPreviewFailure,
  PreviewCard,
} from './types';
export { LINK_PREVIEW_PROVIDER_NAMES } from './types';

export { LinkPreviewProviderRegistry } from './registry';
export {
  createDefaultLinkPreviewRegistry,
  DEFAULT_PROXY_HOSTS,
  type LinkPreviewRegistryDeps,
} from './default-registry';

export { OgClient, parseOpenGraph, type OpenGraphMeta, type OgClientOptions } from './og-client';
export { translateLinkPreviewError, invalidResponseError } from './error-translator';

export { createRewriteProvider, type RewriteSpec } from './providers/rewrite-provider';
export { createTwitterProvider } from './providers/twitter';
export { createInstagramProvider } from './providers/instagram';
export { createThreadsProvider } from './providers/threads';
export { createFacebookProvider } from './providers/facebook';
export { createBahamutProvider } from './providers/bahamut';
