import { 
    Client,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    Guild,
    Channel,
    TextChannel,
    PublicThreadChannel,
} from 'discord.js';
import { VoiceConnection } from "@discordjs/voice";
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';

export interface Bot {
    client: Client;
    token: string;
    mongoURI: string;
    clientId: string;
    config: Config;
    guildInfo: Record<string, GuildInfo>;
    
    slashCommands?: RESTPostAPIChatInputApplicationCommandsJSONBody[];
    slashCommandsHandler?: Map<string, Function>;
    voice?: Voice;

    login(): void;
    registerGuild(): void;
    initSlashCommands(): void;
    initSlashCommandsHandlers(): void;
    registerSlashCommands(): void;
}

export interface Config {
    guilds: GuildConfig[];
    identities: Record<string, Identity>;
    commands: Command[];
}

export interface GuildInfo {
    bot_name: string;
    guild: Guild
    channels: Record<string, Channel>;
}

interface GuildConfig {
    guild_id: string;
    channels: Record<string, string>;
}

interface Identity {
    avator_url: string;
    color_role: string;
}

export interface Command {
    name: string;
    description: string;
    options?: {
        string?: CommandOption[];
        number?: CommandOption[];
        user?: CommandOption[];
        channel?: CommandOption[];
        attachment?: CommandOption[];
    };
}

interface CommandOption {
    name: string;
    description: string;
    required: boolean;
    choices?: CommandChoice[];
}

interface CommandChoice {
    name: string;
    value: string;
}

export interface Voice {
    recorder: VoiceRecorder;
    connection: VoiceConnection | null;
}

export type AllowedTextChannel = TextChannel | PublicThreadChannel;