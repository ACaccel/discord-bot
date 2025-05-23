import axios from "axios";
import { AttachmentBuilder, Guild } from "discord.js";
import schedule from 'node-schedule';
import * as fs from 'fs/promises';

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
    if (msg.length > 30) {
        return null;
    }

    // translate api
    const request = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=${msg}`;
    const translate_res = await axios.get(request);
    const tts_msg = translate_res.data[0][0][0];
    if (!tts_msg) {
        return null;
    }
    if (tts_msg.includes(" ")) {
        return null;
    }
    // console.log(`[TTS] ${msg} -> ${tts_msg}`);

    // tts api
    const tts_api = 'http://localhost:7860/run/predict/';
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

    // read the voice file and send
    const old_file_path = response.data.data[1].name; // e.g., "C:\\users\\acaccel\\Temp\\tmpw_21f5gi.wav"
    const file_name = old_file_path.split(/[\\/]/).pop();
    const new_file_path = `/home/acaccel/.wine/drive_c/users/acaccel/Temp/${file_name}`;
    const buffer = await fs.readFile(new_file_path);
    const timestamp = new Date().toLocaleString().replace(/\/|:|\s/g, "-");
    const attachment = new AttachmentBuilder(buffer, { name: `${timestamp}.wav` })
    return attachment;
}