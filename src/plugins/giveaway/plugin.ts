/**
 * GiveawayPlugin — schedules the giveaway-job reboot on `onReady`.
 *
 * The plugin resolves its dependencies through `ctx` and calls
 * `rebootGiveawayJobs` directly, so composition roots never deep-import
 * `./internal`.
 */
import { TOKENS } from '../../core/ioc';
import type { Plugin } from '../../core/plugin';
import { type GiveawayDeps, rebootGiveawayJobs } from './internal/giveaway';

const PLUGIN_ID = 'giveaway';
const PLUGIN_VERSION = '1.0.0';

export const createGiveawayPlugin = (): Plugin => ({
  id: PLUGIN_ID,
  version: PLUGIN_VERSION,
  scope: 'bot',
  critical: false,

  async onReady(ctx): Promise<void> {
    try {
      const client = ctx.resolve(TOKENS.DiscordClient);
      const deps: GiveawayDeps = {
        client,
        registry: ctx.resolve(TOKENS.GuildRegistry),
        jobMap: ctx.resolve(TOKENS.JobMap),
        logger: ctx.logger,
        clientId: client.user?.id ?? 'unknown',
        translator: ctx.translator,
      };
      await rebootGiveawayJobs(deps);
    } catch (err: unknown) {
      ctx.logger.error(
        { err: err instanceof Error ? err : new Error(String(err)) },
        'giveaway: rebootJobs threw on ready; scheduled jobs may be missing',
      );
    }
  },
});
