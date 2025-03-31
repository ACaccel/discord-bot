import { Guild } from "discord.js";
import schedule from 'node-schedule';

export const listChannels = (guild: Guild | undefined) => {
    if (!guild) {
        return;
    }
    guild.channels.cache.forEach((channel) => {
        console.log(channel.id, channel.name, channel.type);
    });
}

export const scheduleJob = (date: Date, callback: () => void) => {
    return schedule.scheduleJob(date, callback);
};

export const deleteJob = (job: schedule.Job) => {
    job.cancel();
}