/**
 * Bahamut (巴哈姆特, gamer.com.tw) provider. No public embed-proxy exists
 * for Bahamut, so this provider fetches the page's OpenGraph metadata via
 * the SSRF-safe {@link OgClient} and returns a neutral {@link PreviewCard}
 * the plugin renders into a static embed.
 *
 * `canHandle` restricts fetches to the `gamer.com.tw` domain (the SSRF
 * allow-list). A page with no `og:image` yields `Ok(null)` — there is
 * nothing better than Discord's default unfurl to offer, so the caller
 * skips it silently.
 */
import { ok, err, type Result } from '../../../core/result';

import { invalidResponseError } from '../error-translator';
import type { OgClient } from '../og-client';
import type {
  LinkPreviewBuildContext,
  LinkPreviewFailure,
  LinkPreviewProvider,
  LinkPreviewResult,
} from '../types';

const PROVIDER_NAME = 'bahamut';
/** Human-readable label for the embed footer when og:site_name is absent. */
const SITE_LABEL = 'Bahamut';

/** Matches `gamer.com.tw` and any of its subdomains (forum/home/gnn/m/...). */
const isBahamutHost = (host: string): boolean =>
  host === 'gamer.com.tw' || host.endsWith('.gamer.com.tw');

export const createBahamutProvider = (ogClient: OgClient): LinkPreviewProvider => ({
  name: PROVIDER_NAME,
  canHandle: (url) => isBahamutHost(url.hostname.toLowerCase()),
  build: async (
    url: URL,
    ctx: LinkPreviewBuildContext,
  ): Promise<Result<LinkPreviewResult | null, LinkPreviewFailure>> => {
    const result = await ogClient.fetch(url.href, PROVIDER_NAME, ctx.timeoutMs);
    if (!result.ok) return result;

    const og = result.value;
    const image = og.images[0];
    if (image === undefined) {
      // No image to improve on; skip rather than post a text-only card.
      return ok(null);
    }
    // A successful fetch with an image but no title is a malformed page.
    if (og.title === undefined || og.title.length === 0) {
      return err(invalidResponseError(PROVIDER_NAME));
    }

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
  },
});
