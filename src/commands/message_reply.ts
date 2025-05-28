import { Message, TextChannel } from "discord.js";
import { BaseBot } from "@dcbotTypes";
import { tts_api } from "utils/misc";

export const anti_dizzy_react = async (msg: Message) => {
    const content = msg.content;
    const andyDictionary = [
        /暈/, /她{1}不{0,1}在{1}/, /他{1}不{0,1}在{1}/, /女{1}朋{0,1}友{1}/, /男{1}朋{0,1}友{1}/
    ]
    if(andyDictionary.some((e) => content.match(e))) {
        await msg.react('1067851490271711312');
    }
}

export const tts_reply = async (msg: Message) => {
    if (msg.content === "tts") {
        const ref_msg_ch = msg.guild?.channels.cache.get(msg.reference?.channelId as string) as TextChannel;
        const ref_msg = ref_msg_ch?.messages.cache.get(msg.reference?.messageId as string)?.content;
        if (!ref_msg) {
            await msg.reply("Cannot find the message");
            return null;
        }

        const { attachment, error } = await tts_api(ref_msg);
        if (error || !attachment) {
            await msg.reply(error);
            return;
        }
        await msg.reply({ files: [attachment] });
    }
}

const search_reply = async (msg: string, bot: BaseBot, guild_id: string) => {
    // search reply from database
    let success = false;
    const db = bot.guildInfo[guild_id].db;
    if (!db) {
        throw new Error("Cannot connect to MongoDB.");
    }
    let res = await db.models["Reply"].find({input: msg});
    success = (res.length !== 0);
    
    // if number of reply > 1, randomly select one
    let reply = "";
    if(res.length !== 0) {
        reply = res[Math.floor(Math.random() * res.length)].reply;
    }
    return { reply, success };
}

export const auto_reply = async (msg: Message, bot: BaseBot, guild_id: string, use_tts: boolean = false) => {
    if (!msg.channel.isSendable()) return;

    if (msg.content.includes('該睡覺了，肥貓跟你說晚安')) {
        await msg.reply('健康に良くない！<:ave_mortis_bad_for_health:1333052644368846878>')
    }

    if (msg.author.bot) return; // prevent recusive reply
    
    // normal reply
    const { reply, success } = await search_reply(msg.content, bot, guild_id);
    if (success) {
        let msg_reply: { content: string; files?: any[] } = { content: reply as string };
        let tts_msg = reply;
        if (!reply.startsWith("http")) {
            tts_msg = tts_msg.replace(/<a?:\w+:\d+>/g, "");
            tts_msg = tts_msg.replace(/:[^:\s]+:/g, "");
        }

        if (use_tts) {
            const { attachment, error } = await tts_api(tts_msg);
            if (!error && attachment) {
                msg_reply = { ...msg_reply, files: [attachment] };
            }
        }

        await msg.channel.send(msg_reply);
    }

    // special reply
    if (msg.author.id === "516912789369913371" && Math.random() > (1-0.01)) {
        // reply to fatcat
        await msg.channel.send("肥貓好gay");
    }
    if (msg.author.id === "705605105352966144" && Math.random() > (1-0.005)) {
        // reply to mubaimu
        await msg.channel.send("晴人杰");
    }
    if (Math.random() > 0.995) {
        // reply to lucky
        const { reply, success } = await search_reply("[*]", bot, guild_id);
        if (success) {
            let msg_reply: { content: string; files?: any[] } = { content: reply as string };
            let tts_msg = reply;
            if (!reply.startsWith("http")) {
                tts_msg = tts_msg.replace(/<a?:\w+:\d+>/g, "");
                tts_msg = tts_msg.replace(/:[^:\s]+:/g, "");
            }
    
            if (use_tts) {
                const { attachment, error } = await tts_api(tts_msg);
                if (!error && attachment) {
                    msg_reply = { ...msg_reply, files: [attachment] };
                }
            }
    
            await msg.channel.send(msg_reply);
        }
    }

    // regex reply
    const regex = /長髮男(?=\s|$)/;
    if (regex.test(msg.content)) {
        await msg.channel.send("去spa");
    }
}