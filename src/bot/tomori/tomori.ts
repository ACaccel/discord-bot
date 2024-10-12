import { 
    Client, 
    GatewayIntentBits, 
    Events,
} from 'discord.js';
import dotenv from "dotenv";
import express from 'express';

import { Config } from '@dcbotTypes';
import utils from '@utils';
import { Tomori } from './types';
import { earthquake_warning } from '@cmd';

import config from './config.json';

dotenv.config({ path: './src/bot/tomori/.env' });

// init
const client = new Client({ intents: [
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
] });
const tomori = new Tomori(
    client,
    process.env.TOKEN as string,
    process.env.MONGO_URI as string,
    process.env.CLIENT_ID as string,
    config as Config
);

// client events
tomori.login();
tomori.client.on(Events.ClientReady, async () => {
    // bot online init
    tomori.registerGuild();
    await tomori.registerSlashCommands();
    tomori.initSlashCommandsHandlers();

    // reboot message
    Object.entries(tomori.guildInfo).forEach(async ([guild_id, guild]) => {
        await utils.debugChannelLogger(guild.channels.debug, `${guild.bot_name}重開機囉!`, 'system');
    });
});

tomori.client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.inGuild()) {
        if (interaction.isChatInputCommand()) {
            tomori.executeSlashCommands(tomori, interaction);
        } else {
            if (!interaction.isAutocomplete()) {
                await interaction.reply({ content: '目前尚不支援此類型的指令喔!', ephemeral: true });
            }
        }
    } else {
        if (!interaction.isAutocomplete()) {
            await interaction.reply({ content: '目前尚不支援在伺服器外使用喔!', ephemeral: true });
        }
    }
});

tomori.client.on(Events.MessageCreate, async (message) => {
    const content = message.content;

    // prevent bot from replying to itself
    if (message.author.id === tomori.client.user?.id) return;

    if (content.includes('該睡覺了，肥貓跟你說晚安')) {
        message.reply('為什麼要睡覺!?<:karyl_fuckyou:1170748129637830708>')
    }
});

tomori.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {

});

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).send('Hello World!');
})

app.post('/api/earthquake', (req, res) => {
    utils.consoleLogger(`地震警報，預估震度${req.body.magnitude}級，${req.body.countdown}秒後抵達!!!`);
    Object.entries(tomori.guildInfo).forEach(async ([guild_id, guild_info]) => {
        earthquake_warning(
            guild_info.channels.earthquake,
            guild_info.roles.earthquake.id,
            req.body.magnitude as number,
            req.body.countdown as number
        )
    });
    res.status(200).send('OK');
})

app.listen(process.env.PORT, () => {
    utils.consoleLogger(`Express server is running on port ${process.env.PORT}`);
});