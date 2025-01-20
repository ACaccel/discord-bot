import { 
    Client, 
    GatewayIntentBits, 
    Events,
} from 'discord.js';
import dotenv from "dotenv";

import { Config, AllowedTextChannel } from '@dcbotTypes';
import { MsgArchive } from './types';
import config from './config.json';
import utils from '@utils';

dotenv.config({ path: './src/bot/msg_archive/.env' });

// init
const client: Client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});
const msgArchive = new MsgArchive(
    client,
    process.env.TOKEN as string,
    process.env.MONGO_URI as string,
    process.env.CLIENT_ID as string,
    config as Config
);

// client events
msgArchive.login();
msgArchive.client.on(Events.ClientReady, async () => {
    // bot online init
    msgArchive.registerGuild();
    msgArchive.messageBackup(msgArchive.msgArchiveConfig.backup_server, 10);

    // reboot message
    Object.entries(msgArchive.guildInfo).forEach(async ([guild_id, guild]) => {
        try {
            const debug_ch = msgArchive.guildInfo[guild_id].channels.debug as AllowedTextChannel;
            await debug_ch.send(`${guild.bot_name}重開機囉!`);
        } catch (error) {
            utils.errorLogger(msgArchive.clientId, error);
        }
    });
});
