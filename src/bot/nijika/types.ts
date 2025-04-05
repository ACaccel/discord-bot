import { 
    Client,
    GuildMember, 
    Message, 
    MessageReaction, 
    PartialGuildMember, 
    PartialMessage,
    PartialMessageReaction,
    PartialUser,
    User
} from 'discord.js';
import {
    BaseBot,
    Config
} from '@dcbotTypes';
import { Job } from 'node-schedule';
import { 
    detectMessageUpdate, 
    detectMessageDelete,
    detectGuildMemberUpdate,
    giveaway,
    scheduleIconChange
} from 'commands';
import nijikaConfig from './config.json';

export class Nijika extends BaseBot {
    public nijikaConfig: NijikaConfig;
    public giveaway_jobs: Map<string, Job>

    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.nijikaConfig = nijikaConfig as NijikaConfig;
        this.giveaway_jobs = new Map();
    }

    public detectMessageUpdate = async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
        if (this.nijikaConfig.blocked_channels.includes(oldMessage.channel.id)) return;
        detectMessageUpdate(oldMessage, newMessage, this);
    }

    public detectMessageDelete = async (message: Message | PartialMessage) => {
        if (this.nijikaConfig.blocked_channels.includes(message.channel.id)) return;
        detectMessageDelete(message, this);
    }

    public detectGuildMemberUpdate = async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember | PartialGuildMember) => {
        detectGuildMemberUpdate(oldMember, newMember, this);
    }

    public detectReactionAdd = async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
        const fetchedReaction = reaction.partial ? await reaction.fetch() : reaction;
        const fetchedUser = user.partial ? await user.fetch() : user;
        
        if (!user.bot) {
            giveaway.addReactionToGiveaway(fetchedReaction, fetchedUser, this);
        }
    }

    public detectReactionRemove = async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
        const fetchedReaction = reaction.partial ? await reaction.fetch() : reaction;
        const fetchedUser = user.partial ? await user.fetch() : user;

        if (!user.bot) {
            giveaway.removeReactionFromGiveaway(fetchedReaction, fetchedUser, this);
        }
    }

    // recover the state
    public rebootProcess = () => {
        giveaway.rebootGiveawayJobs(this);
        // scheduleIconChange(this, "1047744170070118400");
    }
}

interface NijikaConfig {
    blocked_channels: string[];
    giveaway_channel_id: string;
    level_roles: Record<string, string>;
}