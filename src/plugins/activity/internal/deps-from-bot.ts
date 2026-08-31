/**
 * `BaseBot` -> {@link ActivityDeps} bridge for the slash-command path
 * (see `docs/architecture.md` §2 Plugin contract for why the bridge is
 * its own file).
 */
import type { BaseBot } from '../../../bot';

import type { ActivityDeps } from './activity';

export const buildActivityDepsFromBot = (bot: BaseBot): ActivityDeps => ({
  client: bot.client,
  registry: bot.guildRegistry,
  jobMap: bot.jobMap,
  logger: bot.requireLogger(),
  translator: bot.translator,
});
