import { 
    Client, 
    GatewayIntentBits
} from 'discord.js';
import dotenv from "dotenv";
import { MsgArchive } from './msg-archive';
import config from './config.json';
import { loadEnv } from '@core/config';

dotenv.config({ path: './src/bot/msg-archive/.env' });

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
const msgArchive = new MsgArchive(
    client,
    env.TOKEN,
    env.MONGO_URI ?? '',
    env.CLIENT_ID,
    config
);
// The backup loop lives in `MessageBackupPlugin`, scheduled by the
// host's `onReady` hook, so the composition root just starts the bot.
msgArchive.run();