import { 
    Client, 
    GatewayIntentBits, 
    Events,
    ChatInputCommandInteraction,
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
tomori.client.on(Events.ClientReady, async () => {
    utils.consoleLogger(`Logged in as ${tomori.client.user?.username}!`);

    // bot online init
    tomori.registerGuild();
    tomori.initSlashCommands();
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
            let command = interaction as ChatInputCommandInteraction;
            tomori.executeSlashCommands(command);

            await utils.debugChannelLogger(
                tomori.guildInfo[interaction.guildId as string].channels.debug,
                `Interaction created, Command: ${command.commandName}, User: ${command.user.displayName}, Channel: <#${command.channel?.id}>`, 
                'system'
            );
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