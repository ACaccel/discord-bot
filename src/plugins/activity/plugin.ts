/**
 * ActivityPlugin — schedules the legacy activity-job reboot on
 * `onReady`.
 *
 * The plugin takes a `rebootJobs` callback rather than importing
 * `rebootActivityJobs` directly so the plugin module does not
 * transitively pull `internal/` into the strict-mode typecheck
 * scope. Composition roots (which are NOT in the strict scope
 * today — extending it is PR-G's job) supply the closure that
 * captures the bot reference. The callback shape kept by this
 * plugin is what makes the relocation of `features/activity/*`
 * into `./internal/*` (audit C-3 / PR-E E-4) reachable without
 * triggering the full C-10 strict expansion cascade.
 */
import type { Plugin } from '../../core/plugin';

const PLUGIN_ID = 'activity';
const PLUGIN_VERSION = '1.0.0';

export interface ActivityPluginConfig {
  /**
   * Restart every scheduled-activity job. Called once after the
   * Discord `ready` event so the host's typed runtime context is
   * available, mirroring the legacy `BaseBot.init` call order.
   */
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
