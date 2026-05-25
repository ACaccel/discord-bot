/**
 * Bridge that builds an {@link ActivityDeps} bundle from a `BaseBot`
 * reference. Used only by the slash-command handlers in
 * `internal/handlers.ts`; the plugin itself resolves the deps via
 * `ctx.resolve(...)` and never touches `BaseBot`. Kept in its own file
 * so the plugin module does not transitively pull `BaseBot` (and its
 * imports of middlewares / @cmd / @button / ...) into the test-strict
 * compile when the test imports `src/plugins/activity`.
 */
import type { BaseBot } from '../../../bot';
import type { Logger } from '../../../core/logger';

import type { ActivityDeps } from './activity';

export const buildActivityDepsFromBot = (bot: BaseBot): ActivityDeps => ({
    client: bot.client,
    registry: {
        getRepos: (guildId) => bot.getRepos(guildId),
        getChannel: (guildId, name) => bot.getGuildInfo(guildId)?.channels?.[name],
        getRole: (guildId, name) => bot.getGuildInfo(guildId)?.roles?.[name],
        listGuildIds: () => Array.from(bot.getAllGuildInfo().keys()),
    },
    jobMap: bot.jobs,
    logger: bot.logger ?? (undefined as unknown as Logger),
    clientId: bot.clientId,
    translator: bot.translator,
});
