import { 
    Client, 
    GatewayIntentBits, 
    Events,
} from 'discord.js';
import dotenv from "dotenv";
import express from 'express';

import { Config } from '@dcbotTypes';
import { Nijika } from './types';
import { anti_dizzy_react, auto_reply } from '../../commands/message_reply';
import { earthquake_warning } from '@cmd';
import utils from '@utils';
import config from './config.json';

dotenv.config({ path: './src/bot/nijika/.env' });

// init
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
    config as Config
);

// client events
nijika.login();
nijika.client.on(Events.ClientReady, async () => {
    // bot online init
    nijika.registerGuild();
    nijika.connectGuildDB();
    await nijika.registerSlashCommands();
    nijika.initSlashCommandsHandlers();

    // reboot message
    await nijika.rebootMessage();
});

nijika.client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.inGuild()) {
        if (interaction.isChatInputCommand()) {
            await nijika.executeSlashCommands(nijika, interaction);
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

nijika.client.on(Events.MessageCreate, async (message) => {
    const content = message.content
    if (content.includes('該睡覺了，肥貓跟你說晚安')) {
        await message.reply('我不要不要不要不要不要睡覺！<:karyl_fuckyou:1170748129637830708>')
    }
    if (message.author.bot) return;

    try {
        await anti_dizzy_react(message);

        if (message.guildId)
            await auto_reply(message, nijika, message.guildId);
    } catch (e) {
        utils.errorLogger(nijika.clientId, e);
    }
});

nijika.client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (nijika.nijikaConfig.blocked_channels.includes(oldMessage.channel.id)) return;

    try {
        await nijika.detectMessageUpdate(oldMessage, newMessage);
    } catch (e) {
        utils.errorLogger(nijika.clientId, e);
    }
});

nijika.client.on(Events.MessageDelete, async (message) => {
    if (nijika.nijikaConfig.blocked_channels.includes(message.channel.id)) return;

    try {
        await nijika.detectMessageDelete(message);
    } catch (e) {
        utils.errorLogger(nijika.clientId, e);
    }
});

nijika.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
        await nijika.detectGuildMemberUpdate(oldMember, newMember);
    } catch (e) {
        utils.errorLogger(nijika.clientId, e);
    }
});

nijika.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {

});

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).send('Hello World!');
})

app.post('/api/earthquake', (req, res) => {
    utils.systemLogger(nijika.clientId, `地震警報，預估震度${req.body.magnitude}級，${req.body.countdown}秒後抵達!!!`);
    Object.entries(nijika.guildInfo).forEach(async ([guild_id, guild_info]) => {
        if (!guild_info.channels || !guild_info.channels.earthquake) return;
        if (!guild_info.roles || !guild_info.roles.earthquake) return;
        earthquake_warning(
            guild_info.channels.earthquake,
            guild_info.roles.earthquake.id,
            req.body.magnitude as number,
            req.body.countdown as number
        );
    });
    res.status(200).send('OK');
})

app.listen(process.env.PORT, () => {
    utils.systemLogger(nijika.clientId, `Express server is running on port ${process.env.PORT}`)
});