import { 
    Client, 
    GatewayIntentBits
} from 'discord.js';
import dotenv from "dotenv";
import express from 'express';

import { earthquake_warning } from '@event';
import { Nijika } from './nijika';
import config from './config.json';

import { logError, logSystem } from '@core/logger';
import { loadEnv } from '@core/config';
dotenv.config({ path: './src/bot/nijika/.env' });

const env = loadEnv();

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
    env.TOKEN,
    env.MONGO_URI ?? '',
    env.CLIENT_ID,
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
    logSystem(nijika.logger, nijika.clientId, 'Earthquake alert webhook received; broadcasting.');
    // Webhook responds 200 immediately; the per-guild broadcast runs
    // detached. The detached promise must NOT use `forEach(async)` —
    // that drops every per-guild rejection on the floor. Wrap in a
    // single async IIFE so failures inside any guild's send funnel into
    // the structured logger (with the guild id) instead of becoming
    // unhandledRejection. The outer try/catch is defence-in-depth: the
    // per-guild map already catches its own errors, but a future await
    // added BEFORE the .map() would otherwise reopen the
    // unhandledRejection hole this code closes.
    void (async () => {
        try {
            await Promise.all(
                Object.entries(nijika.guildInfo).map(async ([guild_id, guild_info]) => {
                    try {
                        if (!guild_info.channels?.earthquake || !guild_info.roles?.earthquake) return;
                        await earthquake_warning(
                            guild_info.channels.earthquake,
                            guild_info.roles.earthquake.id,
                            nijika.translator,
                        );
                    } catch (err) {
                        logError(nijika.logger, nijika.clientId, guild_id, err);
                    }
                }),
            );
        } catch (err) {
            logError(nijika.logger, nijika.clientId, null, err);
        }
    })();
    res.status(200).send('OK');
})

app.listen(env.PORT, () => {
    logSystem(nijika.logger, nijika.clientId, `discord bot server is running on port ${env.PORT}`)
});