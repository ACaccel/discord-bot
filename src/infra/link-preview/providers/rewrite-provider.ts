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
 * Placeholder titles a proxy / source serves when the post is login-gated,
 * removed, or region-blocked — NOT a real preview. Facebook's share / video
 * endpoints return an OG with only the title "Log in or sign up to view"
 * (no media) for a gated post; scoring that as a usable text card posts a
 * broken "Log in or sign up" embed. Matched case-insensitively as an
 * `og:title` substring.
 */
const JUNK_TITLE_MARKERS: readonly string[] = [
  'log in or sign up',
  'log into facebook',
  'see posts, photos and more on facebook',
  'log in to instagram',
  'login • instagram',
  "this content isn't available",
  'content not found',
  'page not found',
];

/**
 * True when `title` is a known login-wall / not-found placeholder rather
 * than real post content. Pure + exported for unit tests.
 */
export const isJunkPreviewTitle = (title: string): boolean => {
  const normalized = title.toLowerCase();
  return JUNK_TITLE_MARKERS.some((marker) => normalized.includes(marker));
};

/**
 * Rank a candidate proxy's OpenGraph: a playable video beats a static
 * image beats a text-only embed beats nothing usable. A login-wall /
 * not-found placeholder title (with no video) scores `none` so a broken
 * "Log in or sign up" card is never posted. Pure + exported so the
 * selection policy can be tested in isolation from the probe loop.
 */
export const scoreMeta = (meta: OpenGraphMeta): CandidateQuality => {
  if (meta.video !== undefined && meta.video.length > 0) return 'video';
  // A login-wall / not-found page carries no real content even if it serves
  // a generic logo image, so reject it before the image / text tiers.
  if (meta.title !== undefined && isJunkPreviewTitle(meta.title)) return 'none';
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
