import { 
    Client,
    Guild,
    GuildMember, 
    Message, 
    PartialGuildMember, 
    PartialMessage
} from 'discord.js';
import { BaseBot, Config } from '@dcbotTypes';
import { 
    detectMessageUpdate, 
    detectMessageDelete,
    detectGuildMemberUpdate,
    detectGuildCreate
} from 'commands';
import tomoriConfig from './config.json';

export class Tomori extends BaseBot {
    public tomoriConfig: TomoriConfig;
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.tomoriConfig = tomoriConfig as TomoriConfig;
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

        public detectGuildCreate = async (guild: Guild) => {
            detectGuildCreate(guild, this);
        }
}

interface TomoriConfig {
}