/**
 * Guild-create handler retained from the legacy event module.
 *
 * Phase 4b-2 migrated `detectMessageUpdate` / `detectMessageDelete` /
 * `detectGuildMemberUpdate` into `GuildEventsPlugin`. `detectGuildCreate`
 * stays here because it threads through BaseBot.connectOneGuild +
 * commandHandlers — both shapes that the plugin layer does not yet
 * expose as ports. A future phase will fold this into a plugin too.
 */
import { Guild } from 'discord.js';
import { BaseBot, GuildInfo } from '@bot';
import { getCommandJsonBody } from '@cmd';

import { logSystem } from '@core/logger';
export const detectGuildCreate = async (guild: Guild, bot: BaseBot) => {
    // guild info initialization
    let newGuild: GuildInfo = {
        bot_name: guild.members.cache.get(bot.clientId)?.displayName as string,
        guild: guild,
        channels: {},
        roles: {}
    };
    bot.guildInfo[guild.id] = newGuild;

    // DB initialization
    if (!bot.getMongoURI()) {
        throw new Error('No MongoDB URI.');
    }

    // Populate both legacy `db` (for unmigrated callsites) and the
    // typed `repos` bag in one call. Phase 4b removes the legacy half.
    await bot.connectOneGuild(guild.id).catch((err) => {
        throw new Error(`Failed to connect to MongoDB: ${err}`);
    });
    if (!bot.guildInfo[guild.id]?.repos) {
        throw new Error(`Cannot connect to MongoDB for guild ${guild.id}.`);
    }

    const rest_commands = getCommandJsonBody(bot.commandHandlers, bot);
    bot.client.application?.commands.set(rest_commands, guild.id)
    .catch((err) => {
        logSystem(bot.logger, bot.clientId, `Failed to register guild (/) commands: ${err}`);
    });

    // notification
    logSystem(bot.logger, bot.clientId, `Bot added to guild: ${guild.name} (${guild.id})`);
}
