/**
 * `BaseBot` -> {@link GiveawayDeps} bridge for the slash-command path
 * (see `docs/architecture.md` §2 Plugin contract for why the bridge is
 * its own file).
 */
import type { BaseBot } from '../../../bot';

import type { GiveawayDeps } from './giveaway';

export const buildGiveawayDepsFromBot = (bot: BaseBot): GiveawayDeps => ({
  client: bot.client,
  registry: bot.guildRegistry,
  jobMap: bot.jobMap,
  logger: bot.requireLogger(),
  translator: bot.translator,
});
