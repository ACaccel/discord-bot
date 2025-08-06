import { Client } from 'discord.js';
import {
    AllowedTextChannel,
    BaseBot,
    Config
} from '@dcbotTypes';
import utils from '@utils';
import msgArchiveConfig from './config.json';

export class MsgArchive extends BaseBot {
    public msgArchiveConfig: MsgArchiveConfig;

    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.msgArchiveConfig = msgArchiveConfig as MsgArchiveConfig;
    }

    public messageBackup = async (guild_ids: string[], minute: number) => {
        for (const guild_id of guild_ids) {
            await this.backup(guild_id);
        }
        setInterval(async () => {
            for (const guild_id of guild_ids) {
                await this.backup(guild_id);
            }
        }, minute * 60 * 1000);
    }

    public backup = async (guild_id: string) => {
        try {
            const db = this.guildInfo[guild_id].db;
            if (!db) {
                utils.errorLogger(this.clientId, '', "Database not found");
                return;
            }
            if (!this.guildInfo[guild_id].channels || !this.guildInfo[guild_id].channels.debug) {
                utils.errorLogger(this.clientId, '', "Debug channel not found");
                return;
            }
            
            // debug message
            let begin_time = Date.now();
            let newMessageCnt = 0;
            const totalMessageCnt = await db.models["Message"].countDocuments({});
            const debug_ch = this.guildInfo[guild_id].channels["debug"] as AllowedTextChannel;
            const sentMessage = await debug_ch.send(`[ SYSTEM ] on scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages.`);

            // message backup
            const fetchPromise = this.guildInfo[guild_id].guild.channels.cache.map(async (channel) => {
                if (!channel.isTextBased()) return;

                // check fetched channel record
                let lastMessageQuery = await db.models["Fetch"].findOne({channel: channel.name, channelID: channel.id});
                if(lastMessageQuery === null) {
                    const lastMessage = new db.models["Fetch"]({
                        channel: channel.name,
                        channelID:channel.id,
                        lastMessageID: 0
                    })
                    await lastMessage.save();
                }
                
                // fetch messages after ChannelLastMsgID
                let ChannelLastMsgID: string | undefined = (await db.models["Fetch"].findOne({channel: channel.name, channelID: channel.id}))?.lastMessageID;
                let fetchedMessages = await channel.messages.fetch({ 
                    limit: 100, 
                    ...(ChannelLastMsgID && { after: ChannelLastMsgID }) 
                });
                if(fetchedMessages.size === 0) {
                    await sentMessage.edit(`[ SYSTEM ] end scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages.`);
                    return;
                }

                // messages filtering
                fetchedMessages = fetchedMessages.filter(msg => msg.author && !msg.author.bot);
                
                // update ChannelLastMsgID
                ChannelLastMsgID = fetchedMessages.firstKey();
                await db.models["Fetch"].findOneAndUpdate({channel: channel.name, channelID: channel.id}, {lastMessageID: ChannelLastMsgID});

                // save messages to db
                fetchedMessages.forEach(async (msg) => {
                    const newMessage = new db.models["Message"]({
                        channelId: channel.id,
                        channelName: channel.name,
                        content: msg.content,
                        messageId: msg.id,
                        userId: msg.author.id,
                        userName: msg.author.username,
                        attachments: msg.attachments.map(attachment => ({
                            id: attachment.id,
                            name: attachment.name,
                            url: attachment.url,
                            contentType: attachment.contentType
                        })),
                        reactions: msg.reactions.cache.map(reaction => ({
                            id: reaction.emoji.id,
                            name: reaction.emoji.name,
                            animated: reaction.emoji.animated,
                            count: reaction.count,
                            userIds: reaction.users.cache.map(user => user.id)
                        })),
                        stickers: msg.stickers.map(sticker => ({
                            id: sticker.id,
                            name: sticker.name
                        })),
                        timestamp: msg.createdTimestamp
                    });

                    const existedMsg = await db.models["Message"].findOne({ messageId: msg.id });
                    if (!existedMsg) {
                        await newMessage.save();
                        newMessageCnt++;
                        if (newMessageCnt % 50 === 0) {
                            sentMessage.edit(`[ SYSTEM ] on scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages.`);
                        }
                    }
                });
            });
            await Promise.all(fetchPromise);

            // update debug message
            let end_time = Date.now();
            let duration = (end_time - begin_time) / 1000;
            await sentMessage.edit(`[ SYSTEM ] end scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages. (${duration} sec)`);
        } catch (e) {
            utils.errorLogger(this.clientId, '', e);
        }
    }
}

interface MsgArchiveConfig {
    backup_server: string[];
}