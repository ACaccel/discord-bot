/**
 * `BaseBot` -> {@link TempRoleDeps} bridge for the slash-command path
 * (see `docs/architecture.md` §2 Plugin contract for why the bridge is
 * its own file).
 */
import type { BaseBot } from '../../../bot';
import { systemClock } from '../../../core/time';

import type { TempRoleDeps } from './temp-role';

export const buildTempRoleDepsFromBot = (bot: BaseBot): TempRoleDeps => ({
  client: bot.client,
  registry: bot.guildRegistry,
  jobMap: bot.jobMap,
  logger: bot.requireLogger(),
  translator: bot.translator,
  // Command-path deps run on the system wall clock; the plugin's reboot
  // path uses the injected `ctx.clock`, which is the same systemClock in
  // production and a fake clock under test.
  clock: systemClock,
});
