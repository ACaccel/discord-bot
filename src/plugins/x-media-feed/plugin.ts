/**
 * XMediaFeedPlugin — forwards new image/video posts from followed X
 * (Twitter) accounts into a configured Discord channel.
 *
 * Lifecycle wiring only; the pass itself lives in `internal/poll.ts`.
 * `onReady` runs one pass immediately (so a restart surfaces anything
 * missed while the bot was down) and then drives a self-rescheduling
 * `setTimeout` loop, mirroring `message-backup`.
 *
 * Factory pattern (mirrors `createSocialLinkPreviewPlugin`): config is
 * parsed once at composition time — a malformed block fails the boot,
 * not the first pass — and the loop's mutable state is captured in the
 * closure, so the returned object is pure data. `deps` exposes an
 * injectable `source` seam so tests run without the network.
 *
 * Every pass is wrapped so a throw is logged and the loop always
 * reschedules itself.
 */
import { logError, logSystem } from '../../core/logger';
import type { Plugin } from '../../core/plugin';
import { TOKENS } from '../../bot/tokens';
import { FxTwitterTimelineSource, type XTimelineSource } from '../../infra/x-feed';
import { parseXMediaFeedConfig } from './config';
import { reconcileCursors, runFeedPass } from './internal';

const PLUGIN_ID = 'x-media-feed';
const PLUGIN_VERSION = '1.0.0';

/** Optional collaborators wired by the composition root / tests. */
interface CreateXMediaFeedDeps {
  /** Timeline source; injectable so tests can supply fakes without the network. */
  readonly source?: XTimelineSource;
}

export const createXMediaFeedPlugin = (
  rawConfig: unknown,
  deps: CreateXMediaFeedDeps = {},
): Plugin => {
  const config = parseXMediaFeedConfig(rawConfig);
  const source =
    deps.source ??
    new FxTwitterTimelineSource({
      apiBaseUrl: config.apiBaseUrl,
      timeoutMs: config.timeoutMs,
    });

  let loopHandle: NodeJS.Timeout | undefined;
  let stopped = false;
  // Counts completed passes so every `fullSweepEveryPolls`-th one re-reads
  // the full timeline; the first pass is a sweep because the counter
  // starts at zero.
  let passCount = 0;

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,

    async onReady(ctx): Promise<void> {
      if (!config.enabled) {
        logSystem(ctx.logger, 'x-media-feed disabled; not polling');
        return;
      }
      const passDeps = {
        source,
        registry: ctx.resolve(TOKENS.GuildRegistry),
        translator: ctx.translator,
        logger: ctx.logger,
        clock: ctx.clock,
        config,
      };

      const runOnce = async (): Promise<void> => {
        const fullSweep = passCount % config.fullSweepEveryPolls === 0;
        passCount += 1;
        await runFeedPass(passDeps, fullSweep);
      };

      const scheduleNext = (): void => {
        if (stopped) return;
        loopHandle = setTimeout(() => {
          // Run the pass in a self-contained async IIFE: a throw must be
          // caught here and the loop always rescheduled in `finally`.
          // Without this, a rejected pass would die as an
          // unhandledRejection and silently kill the loop.
          void (async (): Promise<void> => {
            try {
              await runOnce();
            } catch (err: unknown) {
              logError(ctx.logger, null, err);
            } finally {
              scheduleNext();
            }
          })();
        }, config.pollIntervalMs);
      };

      // Once per boot, before the first pass: drop cursors whose account
      // was removed from the configuration, so the stored state stays an
      // exact mirror of `accounts`. Non-fatal — a failed sweep must not
      // stop the feed.
      try {
        await reconcileCursors(passDeps);
      } catch (err: unknown) {
        logError(ctx.logger, null, err);
      }

      try {
        await runOnce();
      } catch (err: unknown) {
        logError(ctx.logger, null, err);
      }
      scheduleNext();
    },

    async onShutdown(): Promise<void> {
      stopped = true;
      if (loopHandle !== undefined) {
        clearTimeout(loopHandle);
        loopHandle = undefined;
      }
    },
  };
};
