import { 
    Client,
    GuildMember, 
    Message, 
    MessageReaction, 
    PartialGuildMember, 
    PartialMessage,
    PartialMessageReaction,
    PartialUser,
    TextChannel,
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
        this.help_msg = '### 目前支援的功能：\n' +
                        '1. tts: 回覆一則訊息並輸入tts，bot會產生該訊息的語音檔\n' +
                        '2. auto reply: bot會根據資料庫的message pair回覆訊息\n';
    }

    public detectMessageUpdate = async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
        const blocked_channels = this.nijikaConfig.blocked_channels;
        const parentId = (oldMessage.channel as TextChannel).parentId as string;
        if (blocked_channels.includes(oldMessage.channel.id) || blocked_channels.includes(parentId)) return;
        detectMessageUpdate(oldMessage, newMessage, this);
    }

    public detectMessageDelete = async (message: Message | PartialMessage) => {
        const blocked_channels = this.nijikaConfig.blocked_channels;
        const parentId = (message.channel as TextChannel).parentId as string;
        if (blocked_channels.includes(message.channel.id) || blocked_channels.includes(parentId)) return;
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