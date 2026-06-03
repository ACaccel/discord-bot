/**
 * Template for proxy-rewrite providers (Strategy + Template Method).
 *
 * Every video-capable source (Twitter/X, Instagram, Threads, Facebook)
 * shares one shape: a post URL is rewritten onto a third-party embed-proxy
 * domain so DISCORD unfurls it into a playable video / rich embed. Because
 * proxy domains die and vary in per-content support, the provider VALIDATES
 * before returning: it probes a priority-ordered list of proxy hosts,
 * fetching each candidate's OpenGraph (via {@link OgClient}, with the Discord
 * crawler UA so it sees exactly what Discord will), and picks the best:
 *
 *   - first host whose OG has a video  -> return immediately (playable);
 *   - else the first host with an image (remembered, keep looking for video);
 *   - else the first host with a title  (text-only, weakest fallback);
 *   - else nothing usable -> `ok(null)` so the orchestrator skips silently
 *     and NO bare/dead link is ever posted.
 *
 * Per-host probe failures are logged at debug (proxy flakiness is expected),
 * never surfaced as `Err`. The whole probe sequence is bounded by
 * `ctx.budgetMs` (cumulative) on top of `ctx.timeoutMs` (per host).
 *
 * The per-source files supply `matches` (pure predicate), the `proxyHosts`
 * list, and `toProxyUrl`. This file performs network I/O but returns only a
 * URL string — it must NOT import discord.js.
 */
import { ok, type Result } from '../../../core/result';

import type { OgClient, OpenGraphMeta } from '../og-client';
import type {
  LinkPreviewBuildContext,
  LinkPreviewFailure,
  LinkPreviewProvider,
  LinkPreviewProviderName,
  LinkPreviewResult,
} from '../types';

/** Preview quality of a probed candidate, best to worst. */
export type CandidateQuality = 'video' | 'image' | 'text' | 'none';

/**
 * Placeholder text a proxy / source serves when the post is login-gated,
 * removed, region-blocked, or the proxy failed to fetch it — NOT a real
 * preview. Matched case-insensitively as a substring of `og:title` OR
 * `og:description`. Facebook's gated posts return "Log in or sign up to
 * view" (no media); vxReddit's error page returns the description "Failed
 * to get data from Reddit". Scoring either as a usable card would post a
 * broken embed.
 */
const JUNK_MARKERS: readonly string[] = [
  'log in or sign up',
  'log into facebook',
  'see posts, photos and more on facebook',
  'log in to instagram',
  'login • instagram',
  "this content isn't available",
  'content not found',
  'page not found',
  'failed to get data from reddit',
];

/**
 * Titles that are exactly an embed-proxy's own name — the placeholder it
 * serves as `og:title` on a fetch error (e.g. vxReddit returns
 * `og:title="vxReddit"` when Reddit's API call fails).
 */
const JUNK_EXACT_TITLES: ReadonlySet<string> = new Set(['vxreddit', 'rxddit', 'fxreddit']);

const matchesJunkMarker = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return JUNK_MARKERS.some((marker) => normalized.includes(marker));
};

/**
 * True when `title` is a known login-wall / not-found / proxy-error
 * placeholder rather than real post content. Pure + exported for unit tests.
 */
export const isJunkPreviewTitle = (title: string): boolean =>
  matchesJunkMarker(title) || JUNK_EXACT_TITLES.has(title.trim().toLowerCase());

/** A candidate whose only "content" is a junk placeholder (title or description). */
const isJunkPreview = (meta: OpenGraphMeta): boolean =>
  (meta.title !== undefined && isJunkPreviewTitle(meta.title)) ||
  (meta.description !== undefined && matchesJunkMarker(meta.description));

/**
 * Rank a candidate proxy's OpenGraph: a playable video beats a static
 * image beats a text-only embed beats nothing usable. A login-wall /
 * not-found / proxy-error placeholder (with no video) scores `none` so a
 * broken card is never posted. Pure + exported so the selection policy can
 * be tested in isolation from the probe loop.
 */
export const scoreMeta = (meta: OpenGraphMeta): CandidateQuality => {
  if (meta.video !== undefined && meta.video.length > 0) return 'video';
  // A login-wall / not-found / proxy-error page carries no real content even
  // if it serves a generic logo image, so reject it before the image/text tiers.
  if (isJunkPreview(meta)) return 'none';
  if (meta.images.length > 0) return 'image';
  if (meta.title !== undefined && meta.title.length > 0) return 'text';
  return 'none';
};

export interface RewriteSpec {
  readonly name: LinkPreviewProviderName;
  /** Pure predicate: does this URL point at a previewable post on this source? */
  readonly matches: (url: URL) => boolean;
  /** Priority-ordered embed-proxy hosts to probe. Assumed non-empty (zod `.nonempty()`). */
  readonly proxyHosts: readonly string[];
  /** Build the candidate proxy URL for one host (e.g. host-swap, keep/drop query). */
  readonly toProxyUrl: (url: URL, host: string) => string;
  /** Shared validation fetcher. */
  readonly ogClient: OgClient;
}

const validate = async (
  spec: RewriteSpec,
  url: URL,
  ctx: LinkPreviewBuildContext,
): Promise<Result<LinkPreviewResult | null, LinkPreviewFailure>> => {
  const now = ctx.now ?? Date.now;
  const deadline = ctx.budgetMs !== undefined ? now() + ctx.budgetMs : undefined;

  let bestImage: string | undefined; // candidate whose OG had >=1 image
  let bestText: string | undefined; // candidate whose OG had only a title
  let probed = 0;

  for (const host of spec.proxyHosts) {
    // Always probe the first host; after that, stop once the cumulative
    // budget elapses (regardless of whether a fallback was found yet).
    if (probed > 0 && deadline !== undefined && now() >= deadline) break;
    probed += 1;
    const candidate = spec.toProxyUrl(url, host);
    const res = await spec.ogClient.fetch(candidate, spec.name, ctx.timeoutMs);
    if (!res.ok) {
      ctx.logger?.debug(
        { provider: spec.name, host, code: res.error.code },
        'social-link-preview: proxy probe failed, trying next host',
      );
      continue;
    }
    const quality = scoreMeta(res.value);
    if (quality === 'video') {
      // Best possible — playable video. Short-circuit.
      return ok({ kind: 'rewritten-url', url: candidate, sourceUrl: url.href });
    }
    if (quality === 'image' && bestImage === undefined) {
      bestImage = candidate; // remember, but keep probing for a video
    } else if (quality === 'text' && bestImage === undefined && bestText === undefined) {
      bestText = candidate; // weakest fallback
    }
  }

  const chosen = bestImage ?? bestText;
  return ok(
    chosen === undefined ? null : { kind: 'rewritten-url', url: chosen, sourceUrl: url.href },
  );
};

export const createRewriteProvider = (spec: RewriteSpec): LinkPreviewProvider => ({
  name: spec.name,
  canHandle: (url) => spec.matches(url),
  build: (url, ctx) => validate(spec, url, ctx),
});
