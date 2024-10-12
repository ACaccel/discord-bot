import { Channel } from "discord.js";
import { AllowedTextChannel } from "@dcbotTypes";

const getDate = () => {
    var date = new Date();
    var str = date.getFullYear() + '-' 
            + (date.getMonth() + 1) + '-'
            + date.getDate() + ' ' 
            + date.getHours() + ':' 
            + date.getMinutes() + ':' 
            + date.getSeconds() + ' ';
    return str;
}


const consoleLogger = (msg: string) => {
    console.log('[ DEBUG ] ' + getDate() + msg);
}

const debugChannelLogger = async (debug_ch: Channel, msg: string, status: string) => {
    debug_ch = debug_ch as AllowedTextChannel;
    await debug_ch.send('[ ' + status.toUpperCase() + '] ' + msg);
}

export { consoleLogger, debugChannelLogger };