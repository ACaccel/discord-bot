import { Guild } from "discord.js";

export const listChannels = (guild: Guild | undefined) => {
    if (!guild) {
        return;
    }
    guild.channels.cache.forEach((channel) => {
        console.log(channel.id, channel.name, channel.type);
    });
}