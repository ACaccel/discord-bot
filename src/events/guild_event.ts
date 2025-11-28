import { 
    Message, 
    PartialMessage,
    EmbedBuilder,
    GuildMember,
    PartialGuildMember,
    Guild,
    TextChannel
} from 'discord.js';
import { BaseBot, GuildInfo } from '@bot';
import { getSlashCommandJsonBody } from '@cmd';
import { logger } from '@utils';
import db from '@db';

export const detectMessageUpdate = async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage, bot: BaseBot, blocked_channels?: string[]) => {
    const parentId = (oldMessage.channel as TextChannel).parentId as string;
    if (blocked_channels && (blocked_channels.includes(oldMessage.channel.id) || blocked_channels.includes(parentId))) return;

    if (!oldMessage.content || !newMessage.content || oldMessage.content === newMessage.content) return;
    if (!newMessage.guild || !newMessage.guildId || !newMessage.author || !oldMessage.author) return;
    if (newMessage.author.bot) return;
    if (!newMessage.guild?.id) return;
    if (oldMessage.partial)
        await oldMessage.fetch();
    if (newMessage.partial)
        await newMessage.fetch();

    const event_channel = bot.guildInfo[newMessage.guildId]?.channels?.event;

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
        .setAuthor({ name: newMessage.author.displayName as string, iconURL: newMessage.author.displayAvatarURL() as string })
        .addFields(
            { name: 'author', value: `<@${newMessage.author.id}>`, inline: true },
            { name: 'channel', value: `<#${newMessage.channel.id}>`, inline: true },
            { name: 'old message', value: old_msg, inline: false },
            { name: 'new message', value: new_msg, inline: false }
        )
        .setTimestamp();
    logger.channelLogger(event_channel, embed);

    const log = `User: ${newMessage.author.username}, Channel: ${newMessage.guild.channels.cache.get(newMessage.channel.id)?.name}, Old: ${oldMessage.content}, New: ${newMessage.content}`;
    logger.guildLogger(bot.clientId, newMessage.guild?.id, 'message_update', log, newMessage.guild.name as string);
}

export const detectMessageDelete = async (message: Message | PartialMessage, bot: BaseBot, blocked_channels?: string[]) => {
    const parentId = (message.channel as TextChannel).parentId as string;
    if (blocked_channels && (blocked_channels.includes(message.channel.id) || blocked_channels.includes(parentId))) return;

    if (!message.guild || !message.guildId || !message.author) return;
    if (message.author.bot) return;
    if (!message.guild?.id) return;
    if (message.partial)
        await message.fetch();

    const event_channel = bot.guildInfo[message.guildId as string]?.channels?.event;

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
        .setAuthor({ name: message.author.displayName as string, iconURL: message.author.displayAvatarURL() as string })
        .addFields(
            { name: 'author', value: `<@${message.author.id}>`, inline: true },
            { name: 'channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'message', value: msg, inline: false }
        )
        .setTimestamp();
    if (message.attachments.size > 0) {
        message.attachments.forEach(attachment => {
            if (!attachment.contentType) return;
            if (attachment.contentType.includes('image')) {
                embed.setImage(attachment.url);
            } else {
                embed.addFields({ name: 'attachment', value: attachment.url, inline: false });
            }
            logger.attachmentLogger(message.guild?.id as string, attachment);
        });
    }
    logger.channelLogger(event_channel, embed);

    const log = `User: ${message.author.username}, Channel: ${message.guild.channels.cache.get(message.channel.id)?.name}, Message: ${message.content}`;
    logger.guildLogger(bot.clientId, message.guild?.id, 'message_delete', log, message.guild.name as string);
}

export const detectGuildMemberUpdate = async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember | PartialGuildMember, bot: BaseBot) => {
    if (!newMember.guild.id) return;
    const event_channel = bot.guildInfo[newMember.guild.id]?.channels?.event;
    
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
    if (addedRoles.size === 0 && removedRoles.size === 0) return;
    if (oldMember.partial)
        await oldMember.fetch();
    if (newMember.partial)
        await newMember.fetch();

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
    logger.channelLogger(event_channel, embed);

    const log = `User: ${newMember.user.username}, Added: ${addedRolesList}, Removed: ${removedRolesList}`;
    logger.guildLogger(bot.clientId, newMember.guild.id, 'guild_member_update', log, newMember.guild.name);
}

export const detectGuildCreate = async (guild: Guild, bot: BaseBot) => {
    // guild info initialization
    let newGuild: GuildInfo = {
        bot_name: guild.members.cache.get(bot.clientId)?.displayName as string,
        guild: guild,
        channels: {},
        roles: {}
    };
    bot.guildInfo[guild.id] = newGuild;

    // DB initialization
    if (!bot.getMongoURI()) {
        throw new Error('No MongoDB URI.');
    }

    const database = await db.dbConnect(bot.getMongoURI()!, guild.id)
    .catch((err) => {
        throw new Error(`Failed to connect to MongoDB: ${err}`);
    });
    if (database && bot.guildInfo[guild.id]) {
        bot.guildInfo[guild.id].db = database;
    } else {
        throw new Error(`Cannot connect to MongoDB for guild ${guild.id}.`);
    }

    const rest_commands = getSlashCommandJsonBody(bot.slashCommandHandlers, bot);
    bot.client.application?.commands.set(rest_commands, guild.id)
    .catch((err) => {
        logger.systemLogger(bot.clientId, `Failed to register guild (/) commands: ${err}`);
    });

    // notification
    logger.systemLogger(bot.clientId, `Bot added to guild: ${guild.name} (${guild.id})`);
}