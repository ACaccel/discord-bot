import { 
    Client,
    GuildMember, 
    Message, 
    PartialGuildMember, 
    PartialMessage
} from 'discord.js';
import {
    BaseBot,
    Config
} from '@dcbotTypes';
import { 
    detectMessageUpdate, 
    detectMessageDelete,
    detectGuildMemberUpdate
} from 'commands';
import nijikaConfig from './config.json';

export class Nijika extends BaseBot {
    public nijikaConfig: NijikaConfig;
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.nijikaConfig = nijikaConfig as NijikaConfig;
    }

    public detectMessageUpdate = async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
        detectMessageUpdate(oldMessage, newMessage, this);
    }

    public detectMessageDelete = async (message: Message | PartialMessage) => {
        detectMessageDelete(message, this);
    }

    public detectGuildMemberUpdate = async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember | PartialGuildMember) => {
        detectGuildMemberUpdate(oldMember, newMember, this);
    }
}

interface NijikaConfig {
    blocked_channels: string[];
    level_roles: Record<string, string>;
}