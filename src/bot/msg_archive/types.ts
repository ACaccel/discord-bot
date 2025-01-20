import { Client } from 'discord.js';
import {
    AllowedTextChannel,
    BaseBot,
    Config
} from '@dcbotTypes';
import db from '@db';
import utils from '@utils';
import msgArchiveConfig from './config.json';

export class MsgArchive extends BaseBot {
    public msgArchiveConfig: MsgArchiveConfig;

    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.msgArchiveConfig = msgArchiveConfig as MsgArchiveConfig;
    }

    public messageBackup = (guild_id: string, minute: number) => {
        setInterval(async () => {
            try {
                var begin = Date.now();
                var newMessageCnt = 0;
                const totalMessageCnt = await db.Message.countDocuments({});
                const debug_ch = this.guildInfo[guild_id].channels.debug as AllowedTextChannel;
                const sentMessage = await debug_ch.send(`[ SYSTEM ] on scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages.`);
                const fetchPromise = this.guildInfo[guild_id].guild.channels.cache.map(async(channel) => {
                    // check if channel is already in database
                    const channelName = channel.name;
                    var lastMessageQuery = await db.Fetch.findOne({channel: channelName, channelID: channel.id});
                    if(lastMessageQuery === null) {
                        const lastMessage = new db.Fetch({
                            channel: channelName,
                            channelID:channel.id,
                            lastMessageID: 0
                        })
                        await lastMessage.save();
                    }
                    
                    // fetch messages
                    var lastID = (await db.Fetch.findOne({channel: channel.name, channelID: channel.id}))?.lastMessageID;
                    if (!channel.isTextBased()) return;
                    const fetchedMessages = await channel.messages.fetch({ 
                        limit: 100, 
                        ...(lastID && { after: lastID }) 
                    });

                    if(fetchedMessages.size === 0) {
                        await sentMessage.edit(`[ SYSTEM ] end scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages.`);
                        return;
                    }
                    
                    lastID = fetchedMessages.firstKey();
                    await db.Fetch.findOneAndUpdate({channel: channel.name, channelID: channel.id}, {lastMessageID: lastID});
                    const allMessages = fetchedMessages

                    // save messages
                    for(const f of allMessages) {
                        const e = f[1];
                        const channelID = channel.id;
                        const content = e.content;
                        const userID = e.author.id;
                        const username = e.author.username;
                        const messageID = e.id;
                        const timestamp = e.createdTimestamp;
                        const exists = await db.Message.find({
                            userID: userID, 
                            username: username, 
                            channel: channelName, 
                            channelID: channelID,
                            content: content, 
                            messageID: messageID,
                            timestamp: timestamp
                        })
                        if(exists.length === 0 && content !== "") {
                            const newMessage = new db.Message({
                                channel: channelName,
                                channelID: channelID,
                                content: content,
                                userID: userID,
                                username: username,
                                messageID: messageID,
                                timestamp: timestamp
                            })
                            await newMessage.save();
                            newMessageCnt++;
                            if(newMessageCnt % 1000 == 0) {
                                await sentMessage.edit(`[ SYSTEM ] on scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages.`);
                            }
                        }
                    }
                });
                await Promise.all(fetchPromise);
                var end = Date.now();
                var timeSpent = (end-begin) / 1000;
                await sentMessage.edit(`[ SYSTEM ] end scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages. (${timeSpent} sec)`);
            } catch(e) {
                utils.errorLogger(this.clientId, e);
            }
        }, minute * 60 * 1000);
    }
}

interface MsgArchiveConfig {
    backup_server: string;
}