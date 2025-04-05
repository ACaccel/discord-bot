import { Message } from "discord.js";
import { BaseBot } from "@dcbotTypes";

export const anti_dizzy_react = async (msg: Message) => {
    const content = msg.content;
    const andyDictionary = [
        /暈/, /她{1}不{0,1}在{1}/, /他{1}不{0,1}在{1}/, /女{1}朋{0,1}友{1}/, /男{1}朋{0,1}友{1}/
    ]
    if(andyDictionary.some((e) => content.match(e))) {
        await msg.react('1067851490271711312');
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

export const auto_reply = async (msg: Message, bot: BaseBot, guild_id: string) => {
    if (!msg.channel.isSendable()) return;
    if (msg.author.bot) return; // prevent recusive reply
    
    // normal reply
    const { reply, success } = await search_reply(msg.content, bot, guild_id);
    if (success) { 
        await msg.channel.send(`${reply as string}`);
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
            await msg.channel.send(`${reply as string}`);
        }
    }

    // regex reply
    const regex = /長髮男(?=\s|$)/;
    if (regex.test(msg.content)) {
        await msg.channel.send("去spa");
    }
}