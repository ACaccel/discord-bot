import { 
    Client,
    ChannelType, 
    GuildMember, 
    Message, 
    PartialGuildMember, 
    PartialMessage, 
    EmbedBuilder
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
                } catch(e) {
                    utils.errorLogger(this.clientId, e);
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
        if (!this.guildInfo[newMessage.guildId as string].channels.edit_delete_record) return;
        if (!oldMessage.content || !newMessage.content || oldMessage.content === newMessage.content) return;
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('Message Updated')
            .setAuthor({ name: newMessage.author?.displayName as string, iconURL: newMessage.author?.displayAvatarURL() as string })
            .addFields(
                { name: 'author', value: `<@${newMessage.author?.id}>`, inline: true },
                { name: 'channel', value: `<#${newMessage.channel.id}>`, inline: true },
                { name: 'old message', value: oldMessage.content, inline: false },
                { name: 'new message', value: newMessage.content, inline: false }
            )
            .setTimestamp();
        utils.channelLogger(this.guildInfo[newMessage.guildId as string].channels.edit_delete_record, embed);

        const log = `User: ${newMessage.author?.username}, Channel: ${newMessage.guild?.channels.cache.get(newMessage.channel.id)?.name}, Old: ${oldMessage.content}, New: ${newMessage.content}`;
        utils.guildLogger(this.clientId, 'message_update', log, newMessage.guild?.name as string);
    }

    public detectMessageDelete = async (message: Message | PartialMessage) => {
        if (message.author?.bot) return;
        if (!this.guildInfo[message.guildId as string].channels.edit_delete_record) return;

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('Message Deleted')
            .setAuthor({ name: message.author?.displayName as string, iconURL: message.author?.displayAvatarURL() as string })
            .addFields(
                { name: 'author', value: `<@${message.author?.id}>`, inline: true },
                { name: 'channel', value: `<#${message.channel.id}>`, inline: true },
                { name: 'message', value: message.content ? message.content : 'No content', inline: false }
            )
            .setTimestamp();
        if (message.attachments.size > 0) {
            message.attachments.forEach(attachment => {
                if (attachment.contentType?.includes('image')) {
                    embed.setImage(attachment.url);
                } else {
                    embed.addFields({ name: 'attachment', value: attachment.url, inline: false });
                }
            });
        }
        utils.channelLogger(this.guildInfo[message.guildId as string].channels.edit_delete_record, embed);

        const log = `User: ${message.author?.username}, Channel: ${message.guild?.channels.cache.get(message.channel.id)?.name}, Message: ${message.content}`;
        utils.guildLogger(this.clientId, 'message_delete', log, message.guild?.name as string);
    }

    public detectGuildMemberUpdate = async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember | PartialGuildMember) => {
        if (!this.guildInfo[newMember.guild.id].channels.debug) return;
        
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
        const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
        if (addedRoles.size === 0 && removedRoles.size === 0) return;

        const addedRolesList = addedRoles.map(role => `<@&${role.id}>`).join(', ');
        const removedRolesList = removedRoles.map(role => `<@&${role.id}>`).join(', ');
        const embed = new EmbedBuilder()
            .setColor(0x0000FF)
            .setTitle('Role Update')
            .setAuthor({ name: newMember.user.username, iconURL: newMember.user.displayAvatarURL() })
            .addFields(
                { name: 'user', value: `<@${newMember.user.id}>`, inline: true },
                { name: 'added roles', value: addedRolesList ? addedRolesList : 'No roles added', inline: true },
                { name: 'removed roles', value: removedRolesList ? removedRolesList : 'No roles removed', inline: true }
            )
            .setTimestamp();
        utils.channelLogger(this.guildInfo[newMember.guild.id].channels.debug, embed);

        const log = `User: ${newMember.user.username}, Added: ${addedRolesList}, Removed: ${removedRolesList}`;
        utils.guildLogger(this.clientId, 'guild_member_update', log, newMember.guild.name);
    }
}

interface NijikaConfig {
    bad_words: string[];
    backup_server: string;
}