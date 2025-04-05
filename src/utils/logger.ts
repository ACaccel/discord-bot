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
    } catch (e) {
        console.error('Error saving attachment:', e);
    }
};

/**
 * Log channel events as embedded message to guild's channel.
 */
export const channelLogger = async (channel: Channel | undefined, embed?: EmbedBuilder, log?: string) => {
    try {
        if (!channel) return;
        channel = channel as AllowedTextChannel;

        if (log) {
            await channel.send(log);
        }
        if (embed) {
            await channel.send({ embeds: [embed] });
        }
    } catch (e) {
        console.error(e);
    }
}

/**
 * Log guild events to console and backup to *log* file
 */
export const guildLogger = (bot_id: string, guild_id: string, event_type: string, msg: string, guild_name: string) => {
    try {
        msg = msg.replaceAll('\n', '\\n');
        let new_msg = `[${event_type.toUpperCase()}] <${guild_name}> - ${msg}`;
        console.log(getDate() + new_msg);
        logBackup(new_msg, bot_id, guild_id, 'logs');
    } catch (e) {
        console.error(e);
    }
}

/**
 * Log system information to console and backup to *log* file
 */
export const systemLogger = (bot_id: string, msg: string) => {
    try {
        let new_msg = `[SYSTEM] ${msg}`;
        console.log(getDate() + new_msg);
        logBackup(new_msg, bot_id, '', 'logs');
    } catch (e) {
        console.error(e);
    }
}

/**
 * Log debug information to console and backup to *error* file
 * 
 * guild_id = '' if no guild specified
 */
export const errorLogger = (bot_id: string, guild_id: string | undefined | null, msg: unknown) => {
    try {
        if (guild_id === undefined || guild_id === null) {
            guild_id = '';
        }
        let new_msg = `[ERROR] ${msg}`;
        console.error(getDate() + new_msg);
        logBackup(msg, bot_id, guild_id, 'errors');
    } catch (e) {
        console.error(e);
    }
}

/**
 * Backup logs to file under *log_type* folder
 */
const logBackup = (msg: unknown, bot_id: string, guild_id: string, log_type: string) => {
    try {
        // create a new file every day
        let path = '';
        if (guild_id === '') {
            path = `./${log_type}/${bot_id}/${new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }).replaceAll('/', '_')}.log`;
            if (!fs.existsSync(path)) {
                if (!fs.existsSync(`./${log_type}/${bot_id}`)) {
                    fs.mkdirSync(`./${log_type}/${bot_id}`, { recursive: true });
                }
                fs.writeFileSync(path, '');
            }
        } else {
            path = `./${log_type}/${bot_id}/${guild_id}/${new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }).replaceAll('/', '_')}.log`;
            if (!fs.existsSync(path)) {
                if (!fs.existsSync(`./${log_type}/${bot_id}/${guild_id}`)) {
                    fs.mkdirSync(`./${log_type}/${bot_id}/${guild_id}`, { recursive: true });
                }
                fs.writeFileSync(path, '');
            }
        }

        fs.appendFileSync(path, getDate() + msg + '\n');
    } catch (e) {
        console.error(e);
    }
}