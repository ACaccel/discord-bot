import { Channel } from "discord.js";
import fs from 'fs';
import { AllowedTextChannel } from "@dcbotTypes";

const getDate = () => {
    return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) + ' ';
}

export const consoleLogger = (msg: string, bot_id: string) => {
    console.log(getDate() + msg);
    logBackup(msg, bot_id, 'logs');
}

export const errorLogger = (msg: unknown, bot_id: string) => {
    console.error(getDate() + msg);
    logBackup(msg, bot_id, 'errors');
}

export const channelLogger = async (debug_ch: Channel, msg: string, status: string) => {
    debug_ch = debug_ch as AllowedTextChannel;
    await debug_ch.send('_ _\n' + '[ ' + status.toUpperCase() + '] ' + msg);
}

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