import { 
    Client, 
    GatewayIntentBits
} from 'discord.js';
import dotenv from "dotenv";
import express from 'express';

import { logger } from '@utils';
import { earthquake_warning } from '@event';
import { Nijika } from './nijika';
import config from './config.json';

dotenv.config({ path: './src/bot/nijika/.env' });

// discord client
const client: Client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution
    ] 
});
const nijika = new Nijika(
    client,
    process.env.TOKEN as string,
    process.env.MONGO_URI as string,
    process.env.CLIENT_ID as string,
    config
);
nijika.run();

// bot server
const app = express();
app.use(express.json());
const r = express.Router();
app.use('/discord', r)

r.get('/', (_, res) => {
    res.status(200).send('Hello World!');
})

r.post('/earthquake', (_, res) => {
    logger.systemLogger(nijika.clientId, `地震強震警報!!!`);
    Object.entries(nijika.guildInfo).forEach(async ([_, guild_info]) => {
        if (!guild_info.channels?.earthquake || !guild_info.roles?.earthquake) return;
        earthquake_warning(
            guild_info.channels.earthquake,
            guild_info.roles.earthquake.id
        );
    });
    res.status(200).send('OK');
})

app.listen(process.env.PORT, () => {
    logger.systemLogger(nijika.clientId, `discord bot server is running on port ${process.env.PORT}`)
});