import axios from "axios";
import { AttachmentBuilder, Guild } from "discord.js";
import schedule from 'node-schedule';
import * as fs from 'fs/promises';
import { createCanvas, loadImage } from 'canvas';
import { BaseBot } from "@bot";
import { logger } from "@utils";
// import guild_profile from '../guild_profile.json';

export interface CanvasOptions {
    itemsPerRow: number;
    itemSize: number;
    padding: number;
    textHeight: number;
}

export interface CanvasContent {
    url: string;
    text: string;
}

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

export const getRandomInterval = (min_second: number, max_second: number) => {
    const min = min_second * 1000;
    const max = max_second * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const tts_api = async (msg: string) => {
    if (msg.length > 40) {
        return { attachment: null, error: "Message cannot exceed 40 characters." };
    }

    // translate api
    const request = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=${msg}`;
    const translate_res = await axios.get(request);
    const tts_msg = translate_res.data[0][0][0];
    if (!tts_msg) {
        return { attachment: null, error: "Cannot translate the message." };
    }
    if (tts_msg.includes(" ")) {
        return { attachment: null, error: "Message cannot contain spaces." };
    }
    // console.log(`[TTS] ${msg} -> ${tts_msg}`);

    // tts api
    const tts_api = 'http://localhost:7860/run/predict/';
    const response = await axios.post(tts_api, {
        "fn_index": 0,
        "data": [
            tts_msg,
            "setsuna_short1-3_wav",
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

    // read the voice file and send
    const old_file_path = response.data.data[1].name; // e.g., "C:\\users\\acaccel\\Temp\\tmpw_21f5gi.wav"
    const file_name = old_file_path.split(/[\\/]/).pop();
    const new_file_path = `/home/acaccel/.wine/drive_c/users/acaccel/Temp/${file_name}`;
    const buffer = await fs.readFile(new_file_path);
    const timestamp = new Date().toLocaleString().replace(/\/|:|\s/g, "-");
    const attachment = new AttachmentBuilder(buffer, { name: `${timestamp}.wav` })
    if (!attachment) {
        return { attachment: null, error: "Cannot read the file." };
    }
    return { attachment, error: "" };
}

export const listInOneImage = async (content: CanvasContent[], options?: Partial<CanvasOptions>) => {
    let attachment = null;
    if (content.length > 0) {
        const itemsPerRow = options?.itemsPerRow || 5;
        const itemSize = options?.itemSize || 100;
        const padding = options?.padding || 20;
        const textHeight = options?.textHeight || 30;
        const canvasWidth = itemsPerRow * (itemSize + padding) + padding;
        const rows = Math.ceil(content.length / itemsPerRow);
        const canvasHeight = rows * (itemSize + textHeight + padding) + padding;
        
        const canvas = createCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext('2d');
        
        // Background
        ctx.fillStyle = "#2f3136";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        for (let i = 0; i < content.length; i++) {
            const { url, text } = content[i];
            const row = Math.floor(i / itemsPerRow);
            const col = i % itemsPerRow;
            const x = col * (itemSize + padding) + padding;
            const y = row * (itemSize + textHeight + padding) + padding;
            
            // Draw content
            try {
                const response = await axios.get(url, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);
                const img = await loadImage(buffer);
                ctx.drawImage(img, x, y, itemSize, itemSize);
            } catch (err) {
                // Draw placeholder if image fails to load
                ctx.fillStyle = "#40444b";
                ctx.fillRect(x, y, itemSize, itemSize);
            }
            ctx.fillStyle = "#ffffff";
            ctx.font = "16px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(text, x + itemSize / 2, y + itemSize + 20);
        }
        
        const buffer = canvas.toBuffer('image/png');
        attachment = new AttachmentBuilder(buffer, { name: 'listInOneImage.png' });
    }

    return attachment;
}

export const parseDuration = (duration: string): number | null => {
    const match = duration.match(/^(\d+)([smhdw])$/);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (isNaN(value)) return null;
    switch (unit) {
        case "s": return value * 1000;
        case "m": return value * 60 * 1000;
        case "h": return value * 60 * 60 * 1000;
        case "d": return value * 24 * 60 * 60 * 1000;
        case "w": return value * 7 * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

//========================================//
//======== Change Server Profile =========//
//========================================//
// Uncomment the following code to enable automatic server icon changes
// remember to create and configure guild_profile.json accordingly
// const getRandomImage = () => {
//     if (!guild_profile || guild_profile.length === 0) {
//         throw new Error("No guild profile configuration found, please check guild_profile.json");
//     }
//     const index = Math.floor(Math.random() * guild_profile.length);
//     return guild_profile[index];
// }

// async function updateServerIcon(bot: BaseBot, guildId: string) {
//     const guild = bot.client.guilds.cache.get(guildId);
//     if (!guild) {
//         console.error("cannot find guild");
//         return;
//     }
//     const profile = getRandomImage();
//     try {
//         await guild.setIcon(profile.url);
//         await guild.setName(profile.name);
//     } catch (error) {
//         logger.errorLogger(bot.clientId, guildId, error);
//     }
// }

// export const scheduleIconChange = (bot: BaseBot, guildId: string) => {
//     const interval = getRandomInterval(60, 10*60);
//     console.log(`Next icon change in ${interval / 60 / 1000} minutes`);
//     setTimeout(async () => {
//         await updateServerIcon(bot, guildId);
//         scheduleIconChange(bot, guildId);
//     }, interval);
// }