import { Attachment, Channel, EmbedBuilder } from "discord.js";
import fs from 'fs';
import { AllowedTextChannel } from "@dcbotTypes";
import path from 'path';
import axios from 'axios';

const getDate = () => {
    return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) + ' ';
}

/**
 * (test) save deleted attachments
 */
export const attachmentLogger = async (guild_name: string, attachment: Attachment, ) => {
    try {
        // Define the path where the attachment will be saved
        const filePath = `./data/deleted_attachments/${guild_name}/${getDate().replaceAll('/', '_').replaceAll(':', '_')}${attachment.name}`;

        // Ensure the directory exists
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        // Fetch the attachment data and save it to the file
        const response = await axios.get(attachment.url, { responseType: 'stream' });

        // Save the file
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        // Wait for the file to finish saving
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('Error saving attachment:', error);
    }
};

/**
 * Log guild events to console and backup to *log* file
 */
export const guildLogger = (bot_id: string, event_type: string, msg: string, guild_name: string) => {
    msg = msg.replaceAll('\n', '\\n');
    let new_msg = `[${event_type.toUpperCase()}] <${guild_name}> - ${msg}`;
    console.log(getDate() + new_msg);
    logBackup(new_msg, bot_id, 'logs');
}

/**
 * Log system information to console and backup to *log* file
 */
export const systemLogger = (bot_id: string, msg: string) => {
    let new_msg = `[SYSTEM] ${msg}`;
    console.log(getDate() + new_msg);
    logBackup(new_msg, bot_id, 'logs');
}

/**
 * Log debug information to console and backup to *error* file
 */
export const errorLogger = (bot_id: string, msg: unknown) => {
    console.error(getDate() + msg);
    logBackup(msg, bot_id, 'errors');
}

/**
 * Log channel events as embedded message to guild's channel.
 */
export const channelLogger = async (channel: Channel | undefined, embed?: EmbedBuilder, log?: string) => {
    if (!channel) return;
    channel = channel as AllowedTextChannel;

    if (log) {
        await channel.send(log);
    }
    if (embed) {
        await channel.send({ embeds: [embed] });
    }
}

/**
 * Backup logs to file under *log_type* folder
 */
const logBackup = (msg: unknown, bot_id: string, log_type: string) => {
    // // backup to the same file until the file size is over 1MB, then create a new file
    // const path = `./${log_type}/${bot_id}/${bot_id}.log`;
    // if (!fs.existsSync(`./${log_type}/${bot_id}/${bot_id}.log`)) {
    //     if (!fs.existsSync(`./${log_type}/${bot_id}`)) {
    //         fs.mkdirSync(`./${log_type}/${bot_id}`, { recursive: true });
    //     }
    //     fs.writeFileSync(path, '');
    // }

    // // write to file, if file size is over 1MB, write to a new file
    // fs.stat(path, (err, stats) => {
    //     if (err) throw err;
    //     if (stats.size > 1000000) {
    //         fs.rename(path, `./${log_type}/${bot_id}/${new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })}.log`, (err) => {
    //             if (err) throw err;
    //         });
    //     }
    //     fs.appendFile(path, getDate() + msg + '\n', (err) => {
    //         if (err) throw err;
    //     });
    // });

    // create a new file every day
    const path = `./${log_type}/${bot_id}/${new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }).replaceAll('/', '_')}.log`;
    if (!fs.existsSync(`./${log_type}/${bot_id}/${new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }).replaceAll('/', '_')}.log`)) {
        if (!fs.existsSync(`./${log_type}/${bot_id}`)) {
            fs.mkdirSync(`./${log_type}/${bot_id}`, { recursive: true });
        }
        fs.writeFileSync(path, '');
    }

    try {
        fs.appendFileSync(path, getDate() + msg + '\n');
    } catch (e) {
        console.error(e);
    }
}