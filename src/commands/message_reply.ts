import { AttachmentBuilder, Message, TextChannel } from "discord.js";
import { BaseBot } from "@dcbotTypes";
import axios from "axios";
import * as fs from 'fs/promises';

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
        const tts_api = 'http://localhost:7860/run/predict/';
        const ref_msg_ch = msg.guild?.channels.cache.get(msg.reference?.channelId as string) as TextChannel;
        const tts_msg = ref_msg_ch?.messages.cache.get(msg.reference?.messageId as string)?.content;
        if (!tts_msg) {
            await msg.reply("Cannot find the message");
            return;
        }
        if (tts_msg.includes(" ")) {
            await msg.reply("Message cannot contain space");
            return;
        }

        const response = await axios.post(tts_api, {
            "fn_index": 0,
            "data": [
                tts_msg,
                "setsuna_short1+2_wav",
                "日本語",
                1
            ],
            "session_hash": "s5r78fhbum"
        });

        // sample response:
        // {
        //     "data": [
        //         "Success",
        //         {
        //             "name": "C:\\users\\acaccel\\Temp\\tmpoidxjxg4.wav",
        //             "data": null,
        //             "is_file": true
        //         }
        //     ],
        //     "is_generating": false,
        //     "duration": 0.32135462760925293,
        //     "average_duration": 0.5213330785433451
        // }

        // Extract the file name from the response path
        const old_file_path = response.data.data[1].name; // e.g., "C:\\users\\acaccel\\Temp\\tmpw_21f5gi.wav"
        const file_name = old_file_path.split(/[\\/]/).pop();
        const new_file_path = `/home/acaccel/.wine/drive_c/users/acaccel/Temp/${file_name}`;
        const buffer = await fs.readFile(new_file_path);
        const timestamp = new Date().toLocaleString().replace(/\/|:|\s/g, "-");
        const attachment = new AttachmentBuilder(buffer, { name: `${timestamp}.wav` })
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

export const auto_reply = async (msg: Message, bot: BaseBot, guild_id: string) => {
    if (!msg.channel.isSendable()) return;

    if (msg.content.includes('該睡覺了，肥貓跟你說晚安')) {
        await msg.reply('健康に良くない！<:ave_mortis_bad_for_health:1333052644368846878>')
    }

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