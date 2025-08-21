import { 
    Client, 
    GatewayIntentBits, 
    Events,
} from 'discord.js';
import dotenv from "dotenv";
import express from 'express';

import { Config } from '@dcbotTypes';
import { Nijika } from './types';
import { earthquake_warning, auto_reply, tts_reply } from '@cmd';
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
    try {
        nijika.registerGuild();
        await nijika.connectGuildDB();
        await nijika.registerSlashCommands();
        nijika.initSlashCommandsHandlers();
        nijika.initModalHandlers();
        nijika.initButtonHandlers();
        nijika.initStringSelectMenuHandlers();
        nijika.rebootProcess();
        
        await nijika.rebootMessage();
    } catch (e) {
        utils.errorLogger(nijika.clientId, null, e);
    }
});

nijika.client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.inGuild()) {
            switch (true) {
                case interaction.isChatInputCommand():
                    await nijika.executeSlashCommands(interaction, nijika.nijikaConfig.blocked_channels);
                    break;
                case interaction.isModalSubmit():
                    await nijika.executeModalSubmit(interaction);
                    break;
                case interaction.isButton():
                    await nijika.executeButton(interaction);
                    break;
                case interaction.isStringSelectMenu():
                    await nijika.executeStringSelectMenu(interaction);
                    break;
                default:
                    if (!interaction.isAutocomplete()) {
                        await interaction.reply({ content: '目前尚不支援此類型的指令', ephemeral: true });
                    }
                    break;
            }
        } else {
            if (!interaction.isAutocomplete()) {
                await interaction.reply({ content: '目前尚不支援在伺服器外使用', ephemeral: true });
            }
        }
    } catch (e) {
        utils.errorLogger(nijika.clientId, interaction.guild?.id, e);
    }
});

nijika.client.on(Events.MessageCreate, async (message) => {
    try {
        await tts_reply(message);
        if (message.guildId)
            await auto_reply(message, nijika, message.guildId, true);
    } catch (e) {
        utils.errorLogger(nijika.clientId, message.guild?.id, e);
    }
});

nijika.client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    try {
        await nijika.detectMessageUpdate(oldMessage, newMessage);
    } catch (e) {
        utils.errorLogger(nijika.clientId, oldMessage.guild?.id, e);
    }
});

nijika.client.on(Events.MessageDelete, async (message) => {
    try {
        await nijika.detectMessageDelete(message);
    } catch (e) {
        utils.errorLogger(nijika.clientId, message.guild?.id, e);
    }
});

nijika.client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
        nijika.detectReactionAdd(reaction, user);
    } catch (e) {
        utils.errorLogger(nijika.clientId, reaction.message.guild?.id, e);
    }
});

nijika.client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
        nijika.detectReactionRemove(reaction, user);
    } catch (e) {
        utils.errorLogger(nijika.clientId, reaction.message.guild?.id, e);
    }
});

nijika.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
        await nijika.detectGuildMemberUpdate(oldMember, newMember);
    } catch (e) {
        utils.errorLogger(nijika.clientId, oldMember.guild?.id, e);
    }
});

nijika.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {

});

// bot server
const app = express();
app.use(express.json());
const r = express.Router();
app.use('/discord', r)

r.get('/', (req, res) => {
    res.status(200).send('Hello World!');
})

r.post('/earthquake', (req, res) => {
    utils.systemLogger(nijika.clientId, `地震強震警報!!!`);
    Object.entries(nijika.guildInfo).forEach(async ([guild_id, guild_info]) => {
        if (!guild_info.channels || !guild_info.channels.earthquake) return;
        if (!guild_info.roles || !guild_info.roles.earthquake) return;
        earthquake_warning(
            guild_info.channels.earthquake,
            guild_info.roles.earthquake.id
        );
    });
    res.status(200).send('OK');
})

app.listen(process.env.PORT, () => {
    utils.systemLogger(nijika.clientId, `discord bot server is running on port ${process.env.PORT}`)
});