/**
 * Bridge that builds a {@link TempRoleDeps} bundle from a `BaseBot`
 * reference. Used only by the slash-command handler in
 * `internal/handlers.ts`; the plugin itself resolves its deps via
 * `ctx.resolve(...)` and never touches `BaseBot`. Kept in its own file
 * so the plugin module does not transitively pull `BaseBot` into the
 * test-strict compile when a test imports `src/plugins/temp-role`.
 */
import type { BaseBot } from '../../../bot';
import type { Logger } from '../../../core/logger';
import { systemClock } from '../../../core/time';

import type { TempRoleDeps } from './temp-role';

export const buildTempRoleDepsFromBot = (bot: BaseBot): TempRoleDeps => ({
  client: bot.client,
  registry: {
    getRepos: (guildId) => bot.getRepos(guildId),
    getChannel: (guildId, name) => bot.getGuildInfo(guildId)?.channels?.[name],
    getRole: (guildId, name) => bot.getGuildInfo(guildId)?.roles?.[name],
    listGuildIds: () => Array.from(bot.getAllGuildInfo().keys()),
  },
  jobMap: bot.jobs,
  logger: bot.logger ?? (undefined as unknown as Logger),
  translator: bot.translator,
  // Command-path deps run on the system wall clock; the plugin's reboot
  // path uses the injected `ctx.clock`, which is the same systemClock in
  // production and a fake clock under test.
  clock: systemClock,
});
