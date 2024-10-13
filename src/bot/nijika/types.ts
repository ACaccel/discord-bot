import { 
    Client,
    ChannelType, 
    GuildMember, 
    Message, 
    PartialGuildMember, 
    PartialMessage 
} from 'discord.js';
import { 
    AllowedTextChannel, 
    BaseBot,
    Config
} from '@dcbotTypes';
import db from '@db';
import utils from '@utils';
import nijikaConfig from './config.json';

export class Nijika extends BaseBot {
    nijikaConfig: NijikaConfig;
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.nijikaConfig = nijikaConfig as NijikaConfig;
    }

    public messageBackup = (guiild_id: string, minute: number) => {
        setInterval(async () => {
            var begin = Date.now();
            var newMessageCnt = 0;
            const totalMessageCnt = await db.Message.countDocuments({});
            const debug_ch = this.guildInfo[guiild_id].channels.debug as AllowedTextChannel;
            const sentMessage = await debug_ch.send(`[ SYSTEM ] on scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages.`);
            const fetchPromise = this.guildInfo[guiild_id].guild.channels.cache.map(async(channel) => {
                const channelName = channel.name;
                try {
                    // check if channel is already in database
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
                    if (channel.type === ChannelType.GuildCategory) return;
                    const fetchedMessages = await channel.messages.fetch({ 
                        limit: 100, 
                        ...(lastID && { after: lastID }) 
                    });
                    lastID = fetchedMessages.firstKey();
                    await db.Fetch.findOneAndUpdate({channel: channel.name, channelID: channel.id}, {lastMessageID: lastID});
                    const allMessages = fetchedMessages

                    // save messages
                    for(const f of allMessages) {
                        // let attachment = "";
                        // f.attachments.forEach((e) => {
                        //     attachment = e.attachment
                        // })
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
                            // console.log(channelName, channelID, content, messageID, username, userID, timestamp);
                            try {
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
                            catch(e) {
                                // console.log(e);
                            }
                        }
                    }
                } catch(e) {
                    // console.log(`Fail at ${channelName}`);
                }
            })
            await Promise.all(fetchPromise);
            var end = Date.now();
            var timeSpent = (end-begin) / 1000;
            await sentMessage.edit(`[ SYSTEM ] end scheduled backup process. The database now contains ( ${totalMessageCnt}+${newMessageCnt} ) messages. (${timeSpent} sec)`);

        }, minute * 60 * 1000);
    }

    public detectMessageUpdate = async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
        if (oldMessage.author?.bot) return;
        
        if (oldMessage.content !== newMessage.content) {
            const record_ch = this.guildInfo[newMessage.guildId as string].channels.edit_delete_record as AllowedTextChannel;
            const localTime = new Date(newMessage.createdTimestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            const log = `Message updated, Old: ${oldMessage.content}, New: ${newMessage.content} ` +
                `User: ${newMessage.author?.username}, Channel: <#${newMessage.channel.id}> ` +
                `Time: ${localTime}`;
            await utils.channelLogger(record_ch, log, 'system');
            utils.consoleLogger(log, this.clientId);
        }
    }

    public detectMessageDelete = async (message: Message | PartialMessage) => {
        if (message.author?.bot) return;

        const record_ch = this.guildInfo[message.guildId as string].channels.edit_delete_record as AllowedTextChannel;
        const localTime = new Date(message.createdTimestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        const log = `Message deleted, Content: ${message.content} ` +
            `User: ${message.author?.username}, Channel: <#${message.channel.id}> ` +
            `Time: ${localTime}`;
        await utils.channelLogger(record_ch, log, 'system');
        utils.consoleLogger(log, this.clientId);
    }

    public detectGuildMemberUpdate = async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember | PartialGuildMember) => {
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
        const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
        
        if (addedRoles.size > 0 || removedRoles.size > 0) {
            const debug_ch = this.guildInfo[newMember.guild.id].channels.debug as AllowedTextChannel;
            const localTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            const log = `Guild member roles updated, Added: ${addedRoles.map(role => role.name).join(', ')}, Removed: ${removedRoles.map(role => role.name).join(', ')} ` +
                `User: ${newMember.user.username}, Guild: ${newMember.guild.name} ` +
                `Time: ${localTime}`;
            await utils.channelLogger(debug_ch, log, 'system');
            utils.consoleLogger(log, this.clientId);
        }
    }
}

interface NijikaConfig {
    bad_words: string[];
}