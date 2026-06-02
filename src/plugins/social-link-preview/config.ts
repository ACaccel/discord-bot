/**
 * Configuration schema and defaults for the social-link-preview plugin.
 *
 * Defaults live here in code (zod `.default()`), so a bot may declare an
 * empty / partial `social_link_preview` block in its `config.json` and
 * still boot with a fully-formed, safe (disabled) configuration.
 * `.strict()` surfaces a mistyped key at startup rather than silently
 * ignoring it.
 */
import { z } from 'zod';

import { LINK_PREVIEW_PROVIDER_NAMES } from '../../infra/link-preview';

/** Hard cap so a typo cannot hold a single host probe open for minutes. */
const MAX_TIMEOUT_MS = 15_000;
/** Hard cap on the cumulative validation budget across all host probes. */
const MAX_VALIDATION_BUDGET_MS = 30_000;
/** Hard cap on previews per message, bounding reply fan-out / spam. */
const MAX_URLS_PER_MESSAGE = 5;

const ConfigSchema = z
  .object({
    /** Master switch. Off by default so the feature is strictly opt-in. */
    enabled: z.boolean().default(false),
    /**
     * What to do with the user's original message once a preview is posted:
     *   - `suppress`: hide its auto-generated embed (needs ManageMessages);
     *   - `delete`: remove it entirely (needs ManageMessages);
     *   - `leave`: do nothing (may show two previews).
     */
    originalMessageStrategy: z.enum(['suppress', 'delete', 'leave']).default('suppress'),
    /**
     * Allow-list of enabled providers. Omitted = all providers. Acts as a
     * per-source kill-switch when a proxy service is misbehaving.
     */
    providers: z.array(z.enum(LINK_PREVIEW_PROVIDER_NAMES)).optional(),
    /** Per-host OpenGraph probe / scrape timeout, in milliseconds. */
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).default(4_000),
    /**
     * Cumulative budget for probing a single URL's proxy-host list, in
     * milliseconds. Caps worst-case latency (per-host timeout × list length).
     */
    validationBudgetMs: z.number().int().positive().max(MAX_VALIDATION_BUDGET_MS).default(8_000),
    /**
     * Maximum number of previews to post for a single message. Probing is
     * sequential, so worst-case per-message latency scales as
     * `maxUrlsPerMessage × (validationBudgetMs + timeoutMs)`; keep this small.
     */
    maxUrlsPerMessage: z.number().int().positive().max(MAX_URLS_PER_MESSAGE).default(1),
    /** Embed-proxy hosts for Twitter/X, in priority (probe) order. */
    twitterProxyHosts: z
      .array(z.string().min(1))
      .nonempty()
      .default(['fxtwitter.com', 'vxtwitter.com']),
    /** Embed-proxy hosts for Instagram, in priority order. */
    instagramProxyHosts: z
      .array(z.string().min(1))
      .nonempty()
      .default(['kkinstagram.com', 'uuinstagram.com']),
    /** Embed-proxy hosts for Threads, in priority order (viewthreads serves OG reliably). */
    threadsProxyHosts: z
      .array(z.string().min(1))
      .nonempty()
      .default(['viewthreads.com', 'vxthreads.net']),
    /** Embed-proxy hosts for Facebook, in priority order (facebed covers posts + video). */
    facebookProxyHosts: z
      .array(z.string().min(1))
      .nonempty()
      .default(['facebed.com', 'fixacebook.com']),
  })
  .strict();

export type SocialLinkPreviewPluginConfig = z.infer<typeof ConfigSchema>;

/**
 * Parse a raw `social_link_preview` config block into a fully-defaulted,
 * validated config. Passing `undefined` (the block is absent) yields the
 * all-defaults, disabled configuration rather than throwing.
 *
 * @throws {z.ZodError} when a provided value is the wrong type or an
 *   unknown key is present (fail-fast at composition time).
 */
export const parseSocialLinkPreviewConfig = (raw: unknown): SocialLinkPreviewPluginConfig =>
  ConfigSchema.parse(raw ?? {});
