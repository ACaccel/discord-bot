/**
 * TempRolePlugin — reschedules temporary-role expiry jobs on `onReady`.
 *
 * The plugin resolves its dependencies through `ctx` and calls
 * `rebootTempRoleJobs` directly, so composition roots never deep-import
 * `./internal`. The `/temp_role` command handler bridges into the same
 * internals via its own `BaseBot` reference.
 */
import { TOKENS } from '../../core/plugin';
import type { Plugin } from '../../core/plugin';
import { type TempRoleDeps, rebootTempRoleJobs } from './internal/temp-role';

const PLUGIN_ID = 'temp-role';
const PLUGIN_VERSION = '1.0.0';

export const createTempRolePlugin = (): Plugin => ({
  id: PLUGIN_ID,
  version: PLUGIN_VERSION,
  scope: 'bot',
  critical: false,

  async onReady(ctx): Promise<void> {
    try {
      const client = ctx.resolve(TOKENS.DiscordClient);
      const deps: TempRoleDeps = {
        client,
        registry: ctx.resolve(TOKENS.GuildRegistry),
        jobMap: ctx.resolve(TOKENS.JobMap),
        logger: ctx.logger,
        translator: ctx.translator,
        clock: ctx.clock,
      };
      await rebootTempRoleJobs(deps);
    } catch (err: unknown) {
      ctx.logger.error(
        { err: err instanceof Error ? err : new Error(String(err)) },
        'temp-role: rebootJobs threw on ready; expiry jobs may be missing',
      );
    }
  },
});
