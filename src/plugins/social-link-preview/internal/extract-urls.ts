/**
 * Extract candidate URLs from a message's text.
 *
 * Pure and side-effect free so it is exhaustively unit-testable. Returns
 * de-duplicated, parsed {@link URL}s in first-seen order, bounded by a
 * hard scan limit so a paste-bomb cannot blow up the per-message work.
 * The caller (orchestrator) caps how many of these actually become
 * previews — extraction returns every candidate so a supported link is
 * not crowded out by an unsupported one appearing earlier.
 *
 * URLs the user wrapped in angle brackets (`<https://...>`) are skipped:
 * that is Discord's explicit "do not embed this" syntax, so generating a
 * preview would contradict the user's intent.
 */

/** Matches an http(s) URL up to the first whitespace or angle bracket. */
const URL_RE = /https?:\/\/[^\s<>]+/gi;
/** Upper bound on URLs scanned per message, independent of preview count. */
export const HARD_SCAN_LIMIT = 10;

/** Trailing punctuation that is almost always sentence punctuation, not URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Tracking / share-attribution query params that carry no addressing
 * information. They bloat the rewritten proxy URL and can break a proxy's
 * resolution (e.g. Facebook share links arrive with `?mibextid=...`). A
 * denylist — never an allowlist — so a provider's meaningful params
 * (Facebook `v` / `story_fbid` / `id`, Bahamut `sn` / `bsn` / `snA`) are
 * always preserved; none of those appear here.
 */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'mibextid',
  'fbclid',
  'igsh',
  'igshid',
  'si',
  'ref',
  'ref_src',
  'ref_url',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'twclid',
  'ttclid',
  'yclid',
  'spm',
  '_rdr',
]);

/** A tracking param: any `utm_*` variant, or a name in the denylist. */
const isTrackingParam = (name: string): boolean => {
  const key = name.toLowerCase();
  return key.startsWith('utm_') || TRACKING_PARAMS.has(key);
};

/**
 * Return a copy of `url` with known tracking / share-attribution query
 * params removed (`mibextid`, `utm_*`, `fbclid`, `igsh`, ...). Pure.
 * Applied to every extracted URL so all providers receive a clean link,
 * which also de-duplicates links that differ only by tracking noise.
 */
const stripTrackingParams = (url: URL): URL => {
  const cleaned = new URL(url.href);
  const tracked = [...cleaned.searchParams.keys()].filter(isTrackingParam);
  for (const name of tracked) cleaned.searchParams.delete(name);
  return cleaned;
};

const isAngleWrapped = (content: string, start: number, end: number): boolean =>
  content[start - 1] === '<' && content[end] === '>';

export const extractUrls = (content: string, max: number = HARD_SCAN_LIMIT): URL[] => {
  const seen = new Set<string>();
  const urls: URL[] = [];
  // HARD_SCAN_LIMIT is an absolute ceiling regardless of the caller's request.
  const effectiveMax = Math.min(max, HARD_SCAN_LIMIT);

  for (const match of content.matchAll(URL_RE)) {
    if (urls.length >= effectiveMax) break;
    const raw = match[0];
    const start = match.index;
    if (isAngleWrapped(content, start, start + raw.length)) continue;

    const trimmed = raw.replace(TRAILING_PUNCTUATION, '');
    let parsed: URL;
    try {
      parsed = stripTrackingParams(new URL(trimmed));
    } catch {
      continue; // not a structurally valid URL
    }
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    urls.push(parsed);
  }

  return urls;
};
