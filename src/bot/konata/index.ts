import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { Konata } from './konata';
import config from './config.json';
import { loadEnv } from '@core/config';

dotenv.config({ path: './src/bot/konata/.env' });

const env = loadEnv();

const client: Client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
});

const konata = new Konata(
    client,
    env.TOKEN,
    env.MONGO_URI ?? '',
    env.CLIENT_ID,
    config,
);

konata.run();
