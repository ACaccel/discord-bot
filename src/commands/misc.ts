import { BaseBot } from '@dcbotTypes';
import utils from '@utils';
import guild_profile from '../guild_profile.json'

//========================================//
//======== Change Server Profile =========//
//========================================//
const getRandomImage = () => {
    const index = Math.floor(Math.random() * guild_profile.length);
    return guild_profile[index];
}

async function updateServerIcon(bot: BaseBot, guildId: string) {
    const guild = bot.client.guilds.cache.get(guildId);
    if (!guild) {
        console.error("cannot find guild");
        return;
    }
    const profile = getRandomImage();
    try {
        await guild.setIcon(profile.url);
        await guild.setName(profile.name);
    } catch (error) {
        utils.errorLogger(bot.clientId, guildId, error);
    }
}

export const scheduleIconChange = (bot: BaseBot, guildId: string) => {
    const interval = utils.getRandomInterval(60, 10*60);
    console.log(`Next icon change in ${interval / 60 / 1000} minutes`);
    setTimeout(async () => {
        await updateServerIcon(bot, guildId);
        scheduleIconChange(bot, guildId);
    }, interval);
}