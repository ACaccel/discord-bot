import { GuildMember, EmbedBuilder, Channel } from 'discord.js';
import { Job } from 'node-schedule';
import { BaseBot } from '@bot';
import { bot_cmd, JobManager } from '@utils';

export interface IGiveawayBot {
    jobs: Map<string, Job>
}

export const isGiveawayBot = (bot: BaseBot) => {
    return (bot as BaseBot & IGiveawayBot).jobs !== undefined;
}

export const giveawayJobKey = (message_id: string) => `giveaway:${message_id}`;

export const isGiveawayJobKey = (key: string, messageId: string) =>
    key.startsWith('giveaway:') && key.split(':')[1] === messageId;

export const giveawayAnnouncement = async (channel: Channel, prize: string, prize_owner_id: string, winner_num: number, end_time_date: Date, description: string) => {
    if (!channel.isSendable()) return null;

    const embed = new EmbedBuilder()
        .setTitle(`🎉 抽獎: ${prize}`)
        .addFields(
            { name: "🎁 獎品提供者", value: `<@${prize_owner_id}>` },
            { name: "👤 中獎人數", value: winner_num.toString() },
            { name: "⏰ 抽獎結束於", value: `${end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}` },
            { name: "📌 備註", value: description || "無" }
        )
        .setColor("#F9F900")
        .setFooter({ text: "點擊 🎉 表情符號參加抽獎!" });
    
    const message = await channel.send({ embeds: [embed] });
    if (!message) return null;
    else {
        bot_cmd.msgReact(message, ['🎉']);
        return message.id;
    }
}

export const findGiveaway = async (bot: BaseBot, guild_id: string, message_id: string) => {
    if (!isGiveawayBot(bot)) return false;

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return false;
    }
    const db = bot.guildInfo[guild.id].db;
    if (!db) {
        return false;
    }
    const giveaway = await db.models["Giveaway"].findOne({ message_id });
    if (!giveaway) return false;
    return true;
}

export const scheduleGiveaway = async (bot: BaseBot, guild_id: string, message_id: string) => {
    if (!isGiveawayBot(bot)) return "Bot does not implement IGiveawayBot";
    
    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return "Guild not found";
    }
    const db = bot.guildInfo[guild.id].db;
    if (!db) {
        return "Database not found";
    }
    
    const giveaway = await db.models["Giveaway"].findOne({ message_id });
    if (!giveaway) return "Giveaway not found";
    const giveawayChannel = guild.channels.cache.get(giveaway.channel_id);
    if (!giveawayChannel?.isSendable()) return "Giveaway channel not found";

    const message = await giveawayChannel.messages.fetch(message_id).catch(() => null);
    if (!message) return "Giveaway message not found";

    const reaction = message.reactions.cache.get("🎉");
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
    const participantsArray = participantsMembers;

    // Select winners
    let winners: GuildMember[] = [];
    if (participantsArray.length > 0) {
        const shuffled = [...participantsArray].sort(() => 0.5 - Math.random());
        winners = shuffled.slice(0, Math.min(giveaway.winner_num, shuffled.length));
    }

    // Send results
    await giveawayChannel.send({ 
        content: 
        `🎉 **抽獎結束!** 🎉\n\n**獎品: ${giveaway.prize}**\n\n${
            winners.length > 0
                ? `🏆 **得獎者:**\n${winners.map(winner => `<@${winner.id}>`).join('\n')}\n\n恭喜以上得獎者！請與 <@${giveaway.prize_owner_id}> 聯繫領取獎品!`
                : '😢 **沒有人參加抽獎**'
        }`
    });

    await db.models["Giveaway"].deleteOne({ message_id });
    new JobManager(bot.jobs).cancel(giveawayJobKey(message_id));

    return null;
}

export const deleteGiveaway = async (bot: BaseBot & IGiveawayBot, guild_id: string, message_id: string) => {
    if (!isGiveawayBot(bot)) return "Bot does not implement IGiveawayBot";

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return "Guild not found";
    }
    const db = bot.guildInfo[guild.id].db;
    if (!db) {
        return "Database not found";
    }

    new JobManager(bot.jobs).cancel(giveawayJobKey(message_id));
    await db.models["Giveaway"].deleteOne({ message_id });

    return null;
}

export const rebootGiveawayJobs = async (bot: BaseBot) => {
    const jobManager = new JobManager(bot.jobs);
    Object.values(bot.guildInfo).forEach(guild_info => { 
        if (!guild_info.db) return "Database not found";
        guild_info.db.models["Giveaway"].find({}).then((giveaways: any) => {
            giveaways.forEach((g: any) => {
                const end_time = new Date(g.end_time);
                if (end_time > new Date()) {
                    jobManager.schedule(giveawayJobKey(g.message_id), end_time, async () => {
                        if (await findGiveaway(bot, guild_info.guild.id, g.message_id)) {
                            await scheduleGiveaway(bot, guild_info.guild.id, g.message_id);
                        }
                    });
                } else {
                    deleteGiveaway(bot, guild_info.guild.id, g.message_id);
                }
            });
        });
    });

    return null;
}