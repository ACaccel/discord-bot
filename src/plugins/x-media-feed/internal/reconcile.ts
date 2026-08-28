/**
 * Startup reconciliation: delete cursors whose account is no longer in
 * the configuration.
 *
 * The `accounts` list changes over an operator's lifetime with the feed,
 * but cursors are keyed by handle in each guild's database and nothing
 * else ever deletes them — so a removed account would otherwise leave an
 * orphaned row behind forever. Run once at `onReady`, this sweep keeps
 * the stored state an exact mirror of the configuration.
 *
 * Consequences worth knowing:
 *   - Re-adding a removed account later behaves like a brand-new one:
 *     a fresh baseline is seeded, so posts published while it was
 *     unfollowed are not backfilled. That matches the meaning of
 *     removal — "stop following" — rather than "pause".
 *   - Comparison is by the exact configured string. Changing only a
 *     handle's letter case therefore counts as remove-plus-add (the old
 *     cursor is deleted, a new baseline is seeded), which keeps the
 *     store consistent with `findByHandle`'s exact-match lookup.
 *   - A guild that removed its feed channel but whose accounts are
 *     still configured keeps its cursors: the guild has opted out of
 *     delivery, not the bot out of following, and re-enabling the
 *     channel then resumes without backfill.
 *
 * Failure posture mirrors the poll pass: every database error is logged
 * per guild and skipped — a broken sweep must never block the feed.
 */
import { logError } from '../../../core/logger';
import type { FeedPassDeps } from './poll';

/** Remove every stored cursor whose handle is not configured any more. */
export const reconcileCursors = async (deps: FeedPassDeps): Promise<void> => {
  const followed = new Set(deps.config.accounts.map((account) => account.handle));

  for (const guildId of deps.registry.listGuildIds()) {
    const repos = deps.registry.getRepos(guildId);
    if (repos === undefined) continue;

    const stored = await repos.xFeedCursor.listHandles();
    if (!stored.ok) {
      logError(deps.logger, guildId, stored.error);
      continue;
    }

    for (const handle of stored.value) {
      if (followed.has(handle)) continue;
      const deleted = await repos.xFeedCursor.deleteByHandle(handle);
      if (!deleted.ok) {
        logError(deps.logger, guildId, deleted.error);
        continue;
      }
      deps.logger.info(
        { plugin: 'x-media-feed', guildId, handle },
        'x-media-feed: removed stale cursor for an account no longer configured',
      );
    }
  }
};
