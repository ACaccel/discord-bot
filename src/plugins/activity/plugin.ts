/**
 * ActivityPlugin — schedules the activity-job reboot on `onReady`.
 *
 * The plugin resolves its dependencies through `ctx` and calls
 * `rebootActivityJobs` directly, so composition roots never deep-import
 * `./internal`.
 */
import { TOKENS } from '../../core/plugin';
import type { Plugin } from '../../core/plugin';
import { type ActivityDeps, rebootActivityJobs } from './internal/activity';

const PLUGIN_ID = 'activity';
const PLUGIN_VERSION = '1.0.0';

export const createActivityPlugin = (): Plugin => ({
  id: PLUGIN_ID,
  version: PLUGIN_VERSION,
  scope: 'bot',
  critical: false,

  async onReady(ctx): Promise<void> {
    try {
      const client = ctx.resolve(TOKENS.DiscordClient);
      const deps: ActivityDeps = {
        client,
        registry: ctx.resolve(TOKENS.GuildRegistry),
        jobMap: ctx.resolve(TOKENS.JobMap),
        logger: ctx.logger,
        translator: ctx.translator,
      };
      await rebootActivityJobs(deps);
    } catch (err: unknown) {
      ctx.logger.error(
        { err: err instanceof Error ? err : new Error(String(err)) },
        'activity: rebootJobs threw on ready; scheduled jobs may be missing',
      );
    }
  },
});
