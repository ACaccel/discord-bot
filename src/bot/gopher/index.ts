import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

import { Gopher } from './gopher';
import config from './config.json';

import { loadEnv } from '@core/config';

dotenv.config({ path: './src/bot/gopher/.env' });

// gopher is database-free: it has no per-guild repositories, so MONGO_URI
// is not required. `requirePort` is true because the settings REST API
// needs a listening port.
const env = loadEnv({ requirePort: true, requireDb: false });

// discord client
const client: Client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
});

// `requirePort` above guarantees `env.PORT` is defined; the assertion
// documents that invariant for the type checker. An empty MONGO_URI is
// passed through deliberately (no database) — see `Gopher` / `BaseBot`.
const gopher = new Gopher(
    client,
    env.TOKEN,
    env.MONGO_URI ?? '',
    env.CLIENT_ID,
    config,
    env.PORT as number,
    env.GOPHER_SETTINGS_API_KEY,
);

void gopher.run();
