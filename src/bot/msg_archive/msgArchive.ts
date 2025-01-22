import { 
    Client, 
    GatewayIntentBits, 
    Events,
} from 'discord.js';
import dotenv from "dotenv";
import { Config } from '@dcbotTypes';
import { MsgArchive } from './types';
import config from './config.json';

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
    await msgArchive.connectGuildDB();
    await msgArchive.messageBackup(msgArchive.msgArchiveConfig.backup_server, 30);

    // reboot message
    await msgArchive.rebootMessage();
});
