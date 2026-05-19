/**
 * Bridge that builds an {@link ActivityDeps} bundle from the legacy
 * `BaseBot` reference. Used only by the slash-command handlers in
 * `internal/handlers.ts`; the plugin itself resolves the deps via
 * `ctx.resolve(...)` and never touches `BaseBot`. Kept in its own file
 * so the plugin module does not transitively pull `BaseBot` (and its
 * imports of middlewares / @cmd / @button / ...) into the test-strict
 * compile when the test imports `src/plugins/activity` (audit
 * ARCH-BLOCK3 / PR-G4).
 */
import type { BaseBot } from '../../../bot';
import type { Logger } from '../../../core/logger';

import type { ActivityDeps } from './activity';

export const buildActivityDepsFromBot = (bot: BaseBot): ActivityDeps => ({
    client: bot.client,
    registry: {
        getRepos: (guildId) => bot.guildInfo[guildId]?.repos,
        getChannel: (guildId, name) => bot.guildInfo[guildId]?.channels?.[name],
        getRole: (guildId, name) => bot.guildInfo[guildId]?.roles?.[name],
        listGuildIds: () => Object.keys(bot.guildInfo),
    },
    jobMap: bot.jobs,
    logger: bot.logger ?? (undefined as unknown as Logger),
    clientId: bot.clientId,
    translator: bot.translator,
});
