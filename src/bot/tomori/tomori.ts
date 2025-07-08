import { 
    Client, 
    GatewayIntentBits, 
    Events,
} from 'discord.js';
import dotenv from "dotenv";

import { Config } from '@dcbotTypes';
import { Tomori } from './types';
import { auto_reply } from '@cmd';
import utils from '@utils';
import config from './config.json';

dotenv.config({ path: './src/bot/tomori/.env' });

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
    try {
        // bot init process
        tomori.registerGuild();
        await tomori.connectGuildDB();
        await tomori.registerSlashCommands();
        tomori.initSlashCommandsHandlers();
        tomori.initModalHandlers();
        tomori.initButtonHandlers();
        tomori.initStringSelectMenuHandlers();

        await tomori.rebootMessage();
    } catch (e) {
        utils.errorLogger(tomori.clientId, null, e);
    }
});

tomori.client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.inGuild()) {
            if (interaction.isChatInputCommand()) {
                await tomori.executeSlashCommands(interaction);
            } else if (interaction.isModalSubmit()) {
                await tomori.executeModalSubmit(interaction);
            } else if (interaction.isButton()) {
                await tomori.executeButton(interaction);
            } else {
                if (!interaction.isAutocomplete()) {
                    await interaction.reply({ content: '目前尚不支援此類型的指令', ephemeral: true });
                }
            }
        } else {
            if (!interaction.isAutocomplete()) {
                await interaction.reply({ content: '目前尚不支援在伺服器外使用', ephemeral: true });
            }
        }
    } catch (e) {
        utils.errorLogger(tomori.clientId, interaction.guild?.id, e);
    }
});

tomori.client.on(Events.MessageCreate, async (message) => {
    try {
        if (message.guildId)
            await auto_reply(message, tomori, message.guildId);
    } catch (e) {
        utils.errorLogger(tomori.clientId, message.guild?.id, e);
    }
});

tomori.client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    try {
        await tomori.detectMessageUpdate(oldMessage, newMessage);
    } catch (e) {
        utils.errorLogger(tomori.clientId, newMessage.guild?.id, e);
    }
});

tomori.client.on(Events.MessageDelete, async (message) => {
    try {
        await tomori.detectMessageDelete(message);
    } catch (e) {
        utils.errorLogger(tomori.clientId, message.guild?.id, e);
    }
});

tomori.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
        await tomori.detectGuildMemberUpdate(oldMember, newMember);
    } catch (e) {
        utils.errorLogger(tomori.clientId, newMember.guild.id, e);
    }
});

tomori.client.on(Events.GuildCreate, async (guild) => {
    try {
        await tomori.detectGuildCreate(guild);
    } catch (e) {
        utils.errorLogger(tomori.clientId, guild.id, e);
    }
});

tomori.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {

});