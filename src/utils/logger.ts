import { Channel } from "discord.js";
import { AllowedTextChannel } from "@dcbotTypes";

const getDate = () => {
    return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) + ' ';
}

const consoleLogger = (msg: string) => {
    console.log('[ DEBUG ] ' + getDate() + msg);
}

const debugChannelLogger = async (debug_ch: Channel, msg: string, status: string) => {
    debug_ch = debug_ch as AllowedTextChannel;
    await debug_ch.send('[ ' + status.toUpperCase() + '] ' + msg);
}

export { consoleLogger, debugChannelLogger };