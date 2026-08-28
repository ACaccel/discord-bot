/**
 * One pass of the x-media-feed poller: for every guild that has a
 * database and a configured feed channel, read each followed account's
 * recent posts and forward the new original media posts.
 *
 * Failure isolation is layered so a background loop can never be taken
 * down by one bad guild, account, or send: `runFeedPass` catches per
 * account, `pollAccount` returns early on any `Err` rail, and the plugin
 * wrapping this reschedules itself in a `finally`.
 *
 * Cursor discipline — the invariant the whole design rests on:
 *   - the stored cursor is always a post that was *actually delivered*
 *     (or, on the very first pass, the baseline that suppresses backfill);
 *   - it advances only after a successful send, so a failed send is
 *     retried on the next pass instead of being skipped;
 *   - it is compared by `BigInt` id, never by timestamp, because the
 *     upstream's `since` parameter only gates a `204` and does not
 *     filter the page it returns.
 *
 * The channel is resolved *before* the timeline is read, so a guild that
 * has not configured this feed costs no upstream request and gets no
 * cursor — which is what lets it start cleanly whenever it does opt in.
 */
import type { SendableChannels } from 'discord.js';

import type { GuildRegistry } from '../../../core/guild-registry';
import type { Translator } from '../../../core/i18n';
import { logError, type Logger } from '../../../core/logger';
import type { Clock } from '../../../core/time';
import type { XPost, XTimelineSource } from '../../../infra/x-feed';
import type { Repos } from '../../../persistence/repositories';
import type { XMediaFeedAccount, XMediaFeedPluginConfig } from '../config';
import { newestPostForBaseline, selectPostsToForward, snowflakeFloorAt } from './filter';
import { buildFeedMessage, sendFeedPost } from './post';

/** Milliseconds per second, for converting the clock to the API's unit. */
const MS_PER_SECOND = 1000;

/** Collaborators one pass needs. Assembled once in the plugin's `onReady`. */
export interface FeedPassDeps {
  readonly source: XTimelineSource;
  readonly registry: GuildRegistry;
  readonly translator: Translator;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly config: XMediaFeedPluginConfig;
}

interface AccountPassInput {
  readonly guildId: string;
  readonly repos: Repos;
  readonly account: XMediaFeedAccount;
  /** Already-resolved destination; the caller proved it sendable. */
  readonly channel: SendableChannels;
  /** When true, re-read the whole timeline instead of using the cursor. */
  readonly fullSweep: boolean;
}

/**
 * Seed a cursor without posting anything.
 *
 * Adding an account must not replay its existing timeline into the
 * channel, so the first pass only records where the feed starts.
 *
 * The baseline is the highest id on the page **including reposts**, not
 * merely the account's own posts. X ids are globally time-ordered, so
 * the highest id present is at or above everything already published,
 * and anything the account posts afterwards compares greater. Baselining
 * on own posts alone would leave a repost-only page with no cursor at
 * all — and the *next* pass would then swallow the account's first
 * genuinely new post as its baseline instead of forwarding it.
 *
 * A page that comes back empty has no id to anchor on, so the anchor is
 * {@link snowflakeFloorAt} of the current clock: above everything
 * already published, below everything published afterwards. A plain
 * zero would be below every post ever written, and the next full sweep
 * — which drops `since` and returns the whole page — would drain the
 * account's back catalogue into the channel.
 */
const seedCursor = async (
  deps: FeedPassDeps,
  input: AccountPassInput,
  posts: readonly XPost[],
): Promise<void> => {
  const newest = newestPostForBaseline(posts);
  const nowMs = deps.clock.now();
  // An empty timeline offers no post to anchor on, so the anchor is
  // derived from the clock instead — an id floor rather than zero, or a
  // later full sweep would treat every pre-existing post as new.
  const id = newest?.id ?? snowflakeFloorAt(nowMs);
  const timestamp = newest?.createdTimestamp ?? Math.floor(nowMs / MS_PER_SECOND);

  const stored = await input.repos.xFeedCursor.upsert(input.account.handle, id, timestamp);
  if (!stored.ok) {
    logError(deps.logger, input.guildId, stored.error);
    return;
  }
  deps.logger.info(
    { plugin: 'x-media-feed', guildId: input.guildId, handle: input.account.handle, cursor: id },
    'x-media-feed: baseline cursor seeded; existing posts will not be backfilled',
  );
};

/**
 * Forward `posts` in order, advancing the cursor to the last one that
 * actually reached Discord.
 *
 * The advance happens in a `finally` so a mid-run send failure still
 * records the progress already made; the error then propagates to the
 * per-account boundary in {@link runFeedPass}.
 */
const forwardPosts = async (
  deps: FeedPassDeps,
  input: AccountPassInput,
  posts: readonly XPost[],
): Promise<void> => {
  let delivered: XPost | undefined;
  try {
    for (const post of posts) {
      await sendFeedPost(
        input.channel,
        buildFeedMessage(deps.translator, post, deps.config.embedProxyHost),
      );
      delivered = post;
    }
  } finally {
    if (delivered !== undefined) {
      const stored = await input.repos.xFeedCursor.upsert(
        input.account.handle,
        delivered.id,
        delivered.createdTimestamp,
      );
      if (!stored.ok) logError(deps.logger, input.guildId, stored.error);
    }
  }
};

/** Read one account's timeline for one guild and forward what is new. */
const pollAccount = async (deps: FeedPassDeps, input: AccountPassInput): Promise<void> => {
  const handle = input.account.handle;
  const cursor = await input.repos.xFeedCursor.findByHandle(handle);
  if (!cursor.ok) {
    logError(deps.logger, input.guildId, cursor.error);
    return;
  }

  // `since` is a bandwidth hint only — it decides whether the upstream
  // answers 204 — so it is dropped on a full sweep and before a cursor
  // exists. See the plugin config's `fullSweepEveryPolls` for why a
  // sweep is needed at all.
  const sinceTimestamp =
    input.fullSweep || cursor.value === undefined ? undefined : cursor.value.last_seen_timestamp;
  const fetched = await deps.source.fetchTimeline(handle, { sinceTimestamp });
  if (!fetched.ok) {
    logError(deps.logger, input.guildId, fetched.error);
    return;
  }

  if (cursor.value === undefined) {
    await seedCursor(deps, input, fetched.value);
    return;
  }
  if (fetched.value.length === 0) return;

  const toForward = selectPostsToForward(fetched.value, {
    handle,
    lastSeenId: cursor.value.last_seen_id,
    maxPosts: deps.config.maxPostsPerPoll,
  });
  if (toForward.length === 0) return;
  await forwardPosts(deps, input, toForward);
};

/**
 * Resolve an account's destination channel for a guild.
 *
 * Returns `undefined` when the guild has not configured this feed, which
 * is how a guild opts out. Resolved before any network call so an
 * opted-out guild costs neither an upstream request nor a cursor.
 */
const resolveChannel = (
  deps: FeedPassDeps,
  guildId: string,
  account: XMediaFeedAccount,
): SendableChannels | undefined => {
  const channel = deps.registry.getChannel(guildId, account.channel ?? deps.config.defaultChannel);
  if (channel === undefined || !channel.isSendable()) return undefined;
  return channel;
};

/**
 * Run one full pass across every known guild and configured account.
 *
 * Guilds are walked in series rather than fanned out: the point of the
 * poller is to be a quiet background citizen of a free upstream, and a
 * burst of parallel requests is exactly what gets a client rate-limited.
 */
export const runFeedPass = async (deps: FeedPassDeps, fullSweep: boolean): Promise<void> => {
  for (const guildId of deps.registry.listGuildIds()) {
    const repos = deps.registry.getRepos(guildId);
    // No database for this guild yet — nowhere to keep a cursor, so
    // forwarding would repeat itself on every pass.
    if (repos === undefined) continue;
    for (const account of deps.config.accounts) {
      const channel = resolveChannel(deps, guildId, account);
      if (channel === undefined) continue;
      try {
        await pollAccount(deps, { guildId, repos, account, channel, fullSweep });
      } catch (err: unknown) {
        // One account's failure must not abort the remaining accounts in
        // this pass, nor reject the scheduling loop above.
        logError(deps.logger, guildId, err);
      }
    }
  }
};
