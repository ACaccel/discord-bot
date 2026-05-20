import {
    Client,
    GatewayIntentBits,
} from 'discord.js';
import dotenv from 'dotenv';

import { Nijika } from './nijika';
import config from './config.json';

import { loadEnv } from '@core/config';

dotenv.config({ path: './src/bot/nijika/.env' });

// `requirePort` makes env validation fail fast when `PORT` is absent —
// nijika cannot run without it because the earthquake webhook plugin
// needs a listening port.
const env = loadEnv({ requirePort: true });

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
        GatewayIntentBits.AutoModerationExecution,
    ],
});

// `requirePort` above guarantees `env.PORT` is defined; the assertion
// documents that invariant for the type checker.
const nijika = new Nijika(
    client,
    env.TOKEN,
    env.MONGO_URI ?? '',
    env.CLIENT_ID,
    config,
    env.PORT as number,
);

// Gap D2: the earthquake webhook server is no longer started inline
// here — it is owned by the `earthquake` plugin's `start` hook (see
// `Nijika`'s composition in `nijika.ts`).
void nijika.run();
