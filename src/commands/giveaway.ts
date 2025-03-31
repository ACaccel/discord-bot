import { GuildMember, EmbedBuilder, MessageReaction, User } from 'discord.js';
import { BaseBot, AllowedTextChannel } from '@dcbotTypes';
import { Nijika } from 'bot/nijika/types';
import { giveaway } from '@cmd';
import utils from '@utils';
import { Job } from 'node-schedule';

interface IGiveawayBot {
    giveaway_jobs: Map<string, Job>
}

const isGiveawayBot = (bot: BaseBot) => {
    return (bot as BaseBot & IGiveawayBot).giveaway_jobs !== undefined;
}

export const giveawayAnnouncement = async (channel: AllowedTextChannel, prize: string, prize_owner_id: string, winner_num: number, end_time_date: Date, description: string) => {
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
        await message.react("🎉")
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
    const giveawayChannel = guild.channels.cache.get(giveaway.channel_id) as AllowedTextChannel;
    if (!giveawayChannel) return "Giveaway channel not found";
    const participants = giveaway.participants.map((id: string) => guild.members.cache.get(id)).filter((member: GuildMember | undefined) => member);
    const participantsArray = Array.isArray(participants) ? participants : Array.from(participants.values());

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

    // Delete giveaway from database
    await db.models["Giveaway"].deleteOne({ message_id });

    return null;
}

export const deleteGiveaway = async (bot: BaseBot & IGiveawayBot, guild_id: string, message_id: string) => {
    if (!isGiveawayBot(bot)) return "Bot does not implement IGiveawayBotBot";

    const guild = bot.client.guilds.cache.get(guild_id);
    if (!guild) {
        return "Guild not found";
    }
    const db = bot.guildInfo[guild.id].db;
    if (!db) {
        return "Database not found";
    }

    const job = bot.giveaway_jobs.get(message_id)
    if (job) {
        job.cancel();
        bot.giveaway_jobs.delete(message_id);
    }
    await db.models["Giveaway"].deleteOne({ message_id });

    return null;
}

export const addReactionToGiveaway = async (reaction: MessageReaction, user: User, bot: BaseBot & IGiveawayBot) => {
    if (!isGiveawayBot(bot)) return "Bot does not implement IGiveawayBot";

    bot.giveaway_jobs.forEach(async (job, message_id) => {
        if (reaction.message.id === message_id) {
            const db = bot.guildInfo[reaction.message.guild?.id as string].db
            if (!db) return "Database not found";
            db.models["Giveaway"].findOne({ message_id }).then(async (giveaway: any) => {
                if (!giveaway) return "Giveaway not found";
                if (giveaway.participants.includes(user.id)) return "User already participated";
                giveaway.participants.push(user.id);
                await giveaway.save();
            });
        }
    });

    return null;
}

export const removeReactionFromGiveaway = async (reaction: MessageReaction, user: User, bot: BaseBot & IGiveawayBot) => {
    if (!isGiveawayBot(bot)) return "Bot does not implement IGiveawayBot";

    bot.giveaway_jobs.forEach(async (job, message_id) => {
        if (reaction.message.id === message_id) {
            const db = bot.guildInfo[reaction.message.guild?.id as string].db
            if (!db) return "Database not found";
            db.models["Giveaway"].findOne({ message_id }).then(async (giveaway: any) => {
                if (!giveaway) return "Giveaway not found";
                if (!giveaway.participants.includes(user.id)) return "User did not participate";
                giveaway.participants = giveaway.participants.filter((id: string) => id !== user.id);
                await giveaway.save();
            });
        }
    });

    return null;
}

export const rebootGiveawayJobs = async (bot: Nijika) => {
    Object.values(bot.guildInfo).forEach(guild_info => { 
        if (!guild_info.db) return "Database not found";
        guild_info.db.models["Giveaway"].find({}).then((giveaways: any) => {
            giveaways.forEach((g: any) => {
                // re-schedule all active giveaways
                const end_time = new Date(g.end_time);
                if (end_time > new Date()) {
                    const job = utils.scheduleJob(end_time, async () => {
                        if (await giveaway.findGiveaway(bot, guild_info.guild.id, g.message_id)) {
                            await giveaway.scheduleGiveaway(bot, guild_info.guild.id, g.message_id);
                        }
                    });
                    bot.giveaway_jobs.set(g.message_id, job);
                } else {
                    giveaway.deleteGiveaway(bot, guild_info.guild.id, g.message_id);
                }

                // recover participants
                const guild = bot.client.guilds.cache.get(guild_info.guild.id);
                if (!guild) return "Guild not found";
                const channel = guild.channels.cache.get(g.channel_id) as AllowedTextChannel;
                if (!channel) return "Channel not found";
                channel.messages.fetch(g.message_id).then(async (message) => {
                    if (!message) return "Message not found";
                    const participants = await message.reactions.cache.get("🎉")?.users.fetch();
                    if (!participants) return "Participants not found";
                    participants.forEach(async (user) => {
                        if (user.bot) return;
                        if (!g.participants.includes(user.id)) {
                            g.participants.push(user.id);
                        }
                    });
                    await g.save();
                });
            });
        });
    });

    return null;
}