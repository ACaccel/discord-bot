/**
 * GiveawayPlugin — wires the legacy giveaway lifecycle into the
 * plugin host's `onReady` hook.
 *
 * Phase 4b PR 3 migrates the feature-level callsites that BaseBot.init
 * used to call directly (`giveaway.rebootGiveawayJobs(this)`). The
 * bot opting in passes a `rebootJobs` closure that closes over the
 * bot reference; the plugin invokes it once Discord is fully ready so
 * scheduled giveaway end-time jobs survive restarts.
 *
 * Why a callback factory rather than a container-resolved bot
 * reference: the legacy `rebootGiveawayJobs` reaches deep into
 * `bot.guildInfo[g].db.models["Giveaway"]` and the `bot.jobs` map,
 * neither of which has a typed port yet (they migrate in a later
 * phase). Capturing the bot via closure keeps the plugin decoupled
 * from BaseBot's shape while still preserving behaviour verbatim.
 */
import type { Plugin } from '../../core/plugin';

const PLUGIN_ID = 'giveaway';
const PLUGIN_VERSION = '1.0.0';

export interface GiveawayPluginConfig {
  /**
   * Restart every scheduled-giveaway job. Called once after the
   * Discord `ready` event so the host's typed runtime context is
   * available, mirroring the legacy `BaseBot.init` call order.
   */
  readonly rebootJobs: () => Promise<unknown> | unknown;
}

export const createGiveawayPlugin = (config: GiveawayPluginConfig): Plugin => ({
  id: PLUGIN_ID,
  version: PLUGIN_VERSION,
  scope: 'bot',
  critical: false,

  async onReady(ctx): Promise<void> {
    try {
      await config.rebootJobs();
    } catch (err: unknown) {
      // Match the legacy outer catch in BaseBot.init: any throw from
      // reboot is logged but does not abort startup.
      ctx.logger.error(
        { err: err instanceof Error ? err : new Error(String(err)) },
        'giveaway: rebootJobs threw on ready; scheduled jobs may be missing',
      );
    }
  },
});
