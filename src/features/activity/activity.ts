import { GuildMember, EmbedBuilder, Channel } from 'discord.js';
import { Job } from 'node-schedule';
import { BaseBot } from '@bot';
import { bot_cmd, misc } from '@utils';

export interface IActivityBot {
    jobs: Map<string, Job>
}

export const isActivityBot = (bot: BaseBot) => {
    return (bot as BaseBot & IActivityBot).jobs !== undefined;
}

export const activityJobKey = (activity_id: string) => `activity:${activity_id}`;

export const isActivityJobKey = (key: string, activityId: string) =>
    key.startsWith('activity:') && key.split(':')[1] === activityId;

export const activityAnnouncement = async (activity_id: string, channel: Channel, title: string, description: string, end_time_date: Date) => {
    if (!channel.isSendable()) return null;

    const embed = new EmbedBuilder()
        .setTitle(`📢 活動: ${title}`)
        .addFields(
            { name: "🆔 活動ID", value: activity_id },
            { name: "📌 說明", value: description || "無" },
            { name: "⏰ 活動結束於", value: `${end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}` },
        )
        .setColor("#00BFFF")
        .setFooter({ text: "點擊 ✅ 表情符號參加活動!" });
    
    const message = await channel.send({ embeds: [embed] });
    if (!message) return null;
    else {
        bot_cmd.msgReact(message, ['✅']);
        return message.id;
    }
}

export const findActivity = async (bot: BaseBot, guild_id: string, activity_id: string) => {
    if (!isActivityBot(bot)) return false;

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return false;
    }
    const db = bot.guildInfo[guild.id].db;
    if (!db) {
        return false;
    }
    const activity = await db.models["Activity"].findOne({ activity_id });
    if (!activity) return false;
    return true;
}

export const scheduleActivity = async (bot: BaseBot, guild_id: string, activity_id: string) => {
    if (!isActivityBot(bot)) return "Bot does not implement IActivityBot";
    
    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return "Guild not found";
    }
    const db = bot.guildInfo[guild.id].db;
    if (!db) {
        return "Database not found";
    }
    
    const activity = await db.models["Activity"].findOne({ activity_id });
    if (!activity) return "Activity not found";
    const activityChannel = guild.channels.cache.get(activity.channel_id);
    if (!activityChannel?.isSendable()) return "Activity channel not found";

    const message = await activityChannel.messages.fetch(activity.message_id).catch(() => null);
    if (!message) return "Activity message not found";

    const reaction = message.reactions.cache.get("✅");
    const users = await reaction?.users.fetch().catch(() => null);

    const participantsMembers: GuildMember[] = [];
    if (users) {
        for (const [, user] of users) {
            if (user.bot) continue;
            const member = guild.members.cache.get(user.id);
            if (member) {
                participantsMembers.push(member);
            }
        }
    }
    const participantsArray = participantsMembers.map(m => m.id);

    // Update activity with participants
    await db.models["Activity"].updateOne(
        { activity_id },
        { $set: { participants: participantsArray } }
    );

    // Send results
    await activityChannel.send({ 
        content: 
        `📢 **活動結束!** 📢\n\n**活動: ${activity.title}**\n\n${
            participantsArray.length > 0
                ? `✅ **參與者:**\n${participantsArray.map(id => `<@${id}>`).join('\n')}\n\n共 ${participantsArray.length} 人參與活動！`
                : '😢 **沒有人參加活動**'
        }`
    });

    // Remove job
    const job = bot.jobs.get(activityJobKey(activity_id));
    if (job) {
        job.cancel();
        bot.jobs.delete(activityJobKey(activity_id));
    }

    return null;
}

export const deleteActivity = async (bot: BaseBot & IActivityBot, guild_id: string, activity_id: string) => {
    if (!isActivityBot(bot)) return "Bot does not implement IActivityBot";

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return "Guild not found";
    }
    const db = bot.guildInfo[guild.id].db;
    if (!db) {
        return "Database not found";
    }

    const job = bot.jobs.get(activityJobKey(activity_id));
    if (job) {
        job.cancel();
        bot.jobs.delete(activityJobKey(activity_id));
    }
    await db.models["Activity"].deleteOne({ activity_id });

    return null;
}

export const rebootActivityJobs = async (bot: BaseBot) => {
    Object.values(bot.guildInfo).forEach(guild_info => { 
        if (!guild_info.db) return "Database not found";
        guild_info.db.models["Activity"].find({}).then((activities: any) => {
            activities.forEach((a: any) => {
                // re-schedule all active activities
                const expired_at = new Date(a.expired_at);
                if (expired_at > new Date()) {
                    const job = misc.scheduleJob(expired_at, async () => {
                        if (await findActivity(bot, guild_info.guild.id, a.activity_id)) {
                            await scheduleActivity(bot, guild_info.guild.id, a.activity_id);
                        }
                    });
                    bot.jobs.set(activityJobKey(a.activity_id), job);
                } else {
                    deleteActivity(bot as BaseBot & IActivityBot, guild_info.guild.id, a.activity_id);
                }
            });
        });
    });

    return null;
}
