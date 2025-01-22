import { 
    Client,
    GuildMember, 
    Message, 
    PartialGuildMember, 
    PartialMessage, 
    EmbedBuilder
} from 'discord.js';
import {
    BaseBot,
    Config
} from '@dcbotTypes';
import utils from '@utils';
import nijikaConfig from './config.json';

export class Nijika extends BaseBot {
    public nijikaConfig: NijikaConfig;
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.nijikaConfig = nijikaConfig as NijikaConfig;
    }

    public detectMessageUpdate = async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
        if (oldMessage.author?.bot) return;
        if (!this.guildInfo[newMessage.guildId as string].channels.edit_delete_record) return;
        if (!oldMessage.content || !newMessage.content || oldMessage.content === newMessage.content) return;

        let old_msg = oldMessage.content;
        let new_msg = newMessage.content;
        if (old_msg.length > 1000) {
            old_msg = old_msg.slice(0, 1000);
            old_msg += '...';
        }
        if (new_msg.length > 1000) {
            new_msg = new_msg.slice(0, 1000);
            new_msg += '...';
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('Message Updated')
            .setAuthor({ name: newMessage.author?.displayName as string, iconURL: newMessage.author?.displayAvatarURL() as string })
            .addFields(
                { name: 'author', value: `<@${newMessage.author?.id}>`, inline: true },
                { name: 'channel', value: `<#${newMessage.channel.id}>`, inline: true },
                { name: 'old message', value: old_msg, inline: false },
                { name: 'new message', value: new_msg, inline: false }
            )
            .setTimestamp();
        utils.channelLogger(this.guildInfo[newMessage.guildId as string].channels.edit_delete_record, embed);

        const log = `User: ${newMessage.author?.username}, Channel: ${newMessage.guild?.channels.cache.get(newMessage.channel.id)?.name}, Old: ${oldMessage.content}, New: ${newMessage.content}`;
        utils.guildLogger(this.clientId, 'message_update', log, newMessage.guild?.name as string);
    }

    public detectMessageDelete = async (message: Message | PartialMessage) => {
        if (message.author?.bot) return;
        if (!this.guildInfo[message.guildId as string].channels.edit_delete_record) return;

        let msg = '';
        if (!message.content) {
            msg = 'No content';
        } else if (message.content.length > 1000) {
            msg = message.content.slice(0, 1000);
            msg += '...';
        } else {
            msg = message.content;
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('Message Deleted')
            .setAuthor({ name: message.author?.displayName as string, iconURL: message.author?.displayAvatarURL() as string })
            .addFields(
                { name: 'author', value: `<@${message.author?.id}>`, inline: true },
                { name: 'channel', value: `<#${message.channel.id}>`, inline: true },
                { name: 'message', value: msg, inline: false }
            )
            .setTimestamp();
        if (message.attachments.size > 0) {
            message.attachments.forEach(attachment => {
                if (attachment.contentType?.includes('image')) {
                    embed.setImage(attachment.url);
                } else {
                    embed.addFields({ name: 'attachment', value: attachment.url, inline: false });
                }
                utils.attachmentLogger(this.clientId, attachment);
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
    blocked_channels: string[];
    level_roles: Record<string, string>;
}