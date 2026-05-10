import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { Konata } from './konata';
import config from './config.json';

dotenv.config({ path: './src/bot/konata/.env' });

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
    process.env.TOKEN as string,
    process.env.MONGO_URI as string,
    process.env.CLIENT_ID as string,
    config,
);

konata.run();
