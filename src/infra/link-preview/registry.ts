/**
 * LinkPreviewProviderRegistry — Strategy lookup by URL match.
 *
 * Unlike {@link LlmProviderRegistry}, which keys providers by an enum
 * name, link-preview providers are matched against an arbitrary URL, so
 * the registry holds an ordered list and returns the first provider
 * whose `canHandle` accepts the URL. Registration order therefore
 * encodes priority — a generic fallback (if one is ever added) must be
 * registered last.
 *
 * Providers hold no secrets, so they are stored as ready instances
 * rather than deferred factories.
 */
import type { LinkPreviewProvider } from './types';

export class LinkPreviewProviderRegistry {
  private readonly providers: readonly LinkPreviewProvider[];

  public constructor(providers: Iterable<LinkPreviewProvider>) {
    this.providers = [...providers];
  }

  /**
   * The first registered provider whose `canHandle` accepts `url`, or
   * `undefined` when no provider matches.
   */
  public findProvider(url: URL): LinkPreviewProvider | undefined {
    return this.providers.find((provider) => provider.canHandle(url));
  }
}
