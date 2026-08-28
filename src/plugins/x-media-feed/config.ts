/**
 * Configuration schema and defaults for the x-media-feed plugin.
 *
 * Defaults live here in code (zod `.default()`), so a bot may declare an
 * empty / partial `x_media_feed` block in its `config.json` and still
 * boot with a fully-formed, safe (disabled) configuration. `.strict()`
 * surfaces a mistyped key at startup rather than silently ignoring it.
 */
import { z } from 'zod';

/**
 * Floor on the poll interval. The upstream is a free community service;
 * polling faster than this buys nothing (posts are not that frequent)
 * and only burns someone else's capacity.
 */
const MIN_POLL_INTERVAL_MS = 60_000;
/**
 * Node's `setTimeout` ceiling (2^31 - 1 ms, ~24.8 days). A larger delay
 * overflows the internal 32-bit counter and is silently coerced to 1 ms,
 * turning the poll loop into a near-tight spin.
 */
const MAX_POLL_INTERVAL_MS = 2_147_483_647;
/** Hard cap so a typo cannot hold one request open for minutes. */
const MAX_TIMEOUT_MS = 30_000;
/**
 * Hard cap on posts forwarded per account per pass. Bounds the damage
 * from a cursor reset or an upstream returning a stale page: at worst a
 * channel gets this many messages, not a whole timeline.
 */
const MAX_POSTS_PER_POLL = 20;
/** Discord's limit on handles; X's own limit is 15 characters. */
const MAX_HANDLE_LENGTH = 15;

/**
 * X handles are ASCII letters, digits, and underscores. Validating here
 * means a typo fails at composition time instead of producing a 404 on
 * every pass forever.
 */
const HANDLE_PATTERN = /^[A-Za-z0-9_]+$/;

const AccountSchema = z
  .object({
    /** Handle without the leading `@`. */
    handle: z.string().min(1).max(MAX_HANDLE_LENGTH).regex(HANDLE_PATTERN),
    /**
     * Symbolic channel name resolved through the guild registry, so the
     * actual channel id stays in the guild's `channels` block. Omit to
     * use the plugin-wide {@link ConfigSchema.defaultChannel}.
     */
    channel: z.string().min(1).optional(),
  })
  .strict();

const ConfigSchema = z
  .object({
    /** Master switch. Off by default so the feature is strictly opt-in. */
    enabled: z.boolean().default(false),
    /** Accounts to follow. An empty list makes the poll loop a no-op. */
    accounts: z.array(AccountSchema).default([]),
    /** Symbolic channel name used by accounts that do not name their own. */
    defaultChannel: z.string().min(1).default('x_feed'),
    /** Delay between passes, in milliseconds. */
    pollIntervalMs: z
      .number()
      .int()
      .min(MIN_POLL_INTERVAL_MS)
      .max(MAX_POLL_INTERVAL_MS)
      .default(300_000),
    /**
     * How many passes may use the cheap cursor path before one re-reads
     * the whole timeline.
     *
     * The upstream's `since` parameter is a strict `>`, so a post created
     * in the same second as the newest one already forwarded would stay
     * invisible for as long as that cursor holds — a permanent miss. A
     * periodic full read converts that into a bounded delay. `1` reads
     * fully every pass (correct, more bandwidth); the default reads
     * fully about once an hour at the default interval.
     */
    fullSweepEveryPolls: z.number().int().positive().default(12),
    /** API origin. Point this at a self-hosted instance to avoid the public host. */
    apiBaseUrl: z.string().url().default('https://api.fxtwitter.com'),
    /** Per-request timeout, in milliseconds. */
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).default(8_000),
    /** Upper bound on posts forwarded per account per pass. */
    maxPostsPerPoll: z.number().int().positive().max(MAX_POSTS_PER_POLL).default(5),
    /**
     * Host substituted for `x.com` in the posted link. Discord unfurls
     * the proxy domain into a playable video embed, which a bot-authored
     * embed cannot render — the same mechanism `social-link-preview`
     * uses. Kept configurable so a dead proxy is a config edit.
     */
    embedProxyHost: z.string().min(1).default('fxtwitter.com'),
  })
  .strict()
  .superRefine((value, ctx) => {
    // An enabled feed that follows nobody silently does nothing; surface
    // it at composition time rather than leaving an operator to wonder.
    if (value.enabled && value.accounts.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accounts'],
        message: 'accounts must not be empty when enabled is true',
      });
    }
    // Two entries for one handle would race on a single shared cursor:
    // whichever posted first would advance it past the other's target.
    const handles = value.accounts.map((a) => a.handle.toLowerCase());
    if (new Set(handles).size !== handles.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accounts'],
        message: 'accounts must not contain duplicate handles',
      });
    }
  });

export type XMediaFeedPluginConfig = z.infer<typeof ConfigSchema>;
export type XMediaFeedAccount = XMediaFeedPluginConfig['accounts'][number];

/**
 * Parse a raw `x_media_feed` config block into a fully-defaulted,
 * validated config. Passing `undefined` (the block is absent) yields the
 * all-defaults, disabled configuration rather than throwing.
 *
 * @throws {z.ZodError} when a provided value is the wrong type, an
 *   unknown key is present, or an enabled feed has no / duplicate
 *   accounts (fail-fast at composition time).
 */
export const parseXMediaFeedConfig = (raw: unknown): XMediaFeedPluginConfig =>
  ConfigSchema.parse(raw ?? {});
