/**
 * ActivityPlugin — same shape as GiveawayPlugin; wraps the legacy
 * `activity.rebootActivityJobs(bot)` call into the plugin host's
 * `onReady` hook.
 *
 * See `plugins/giveaway/plugin.ts` for the rationale behind the
 * callback-factory pattern; both plugins are transitional adapters
 * pending a deeper rework of the feature/job layer.
 */
import type { Plugin } from '../../core/plugin';

const PLUGIN_ID = 'activity';
const PLUGIN_VERSION = '1.0.0';

export interface ActivityPluginConfig {
  readonly rebootJobs: () => Promise<unknown> | unknown;
}

export const createActivityPlugin = (config: ActivityPluginConfig): Plugin => ({
  id: PLUGIN_ID,
  version: PLUGIN_VERSION,
  scope: 'bot',
  critical: false,

  async onReady(ctx): Promise<void> {
    try {
      await config.rebootJobs();
    } catch (err: unknown) {
      ctx.logger.error(
        { err: err instanceof Error ? err : new Error(String(err)) },
        'activity: rebootJobs threw on ready; scheduled jobs may be missing',
      );
    }
  },
});
