import { 
    Client, 
    GatewayIntentBits, 
    Events,
} from 'discord.js';
import dotenv from "dotenv";
// import express, { Request, Response } from 'express';
// import axios from 'axios';

import { Config } from '@dcbotTypes';
import db from '@db';
import utils from '@utils';
import { Tomori } from './types';

import config from './config.json';

dotenv.config({ path: './src/bot/tomori/.env' });

// init
const client: Client = new Client({ intents: [
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
const tomori: Tomori = new Tomori(
    client,
    process.env.TOKEN as string,
    process.env.MONGO_URI as string,
    process.env.CLIENT_ID as string,
    config as Config
);
db.dbConnect(tomori.mongoURI);

// client events
tomori.login();
tomori.client.on(Events.ClientReady, () => {
    utils.consoleLogger(`Logged in as ${tomori.client.user?.tag}`);

    // bot online init
    tomori.registerGuild();
    tomori.initSlashCommands();
    tomori.registerSlashCommands();
    tomori.initSlashCommandsHandlers();

    // reboot message
    Object.entries(tomori.guildInfo).forEach(([guild_id, guild]) => {
        utils.debugChannelLogger(guild.channels.debug, `${guild.bot_name}重開機囉!`, 'system');
    });
});

tomori.client.on(Events.InteractionCreate, async (interaction) => {
    tomori.executeSlashCommands(interaction);
});