import { 
    ChannelType
} from 'discord.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import { 
    Command
} from '@dcbotTypes';

export const buildSlashCommands = (config: Command) => {
    const slashCommand = new SlashCommandBuilder()
        .setName(config.name)
        .setDescription(config.description);

    if (!config.options) return null;

    // build required options first
    if (config.options.user) {
        config.options.user.forEach(e => {
            if (e.required) {
                slashCommand.addUserOption(f =>
                    f.setName(e.name)
                    .setDescription(e.description)
                    .setRequired(e.required)
                );
            }
        });
    }
    if (config.options.channel) {
        config.options.channel.forEach(e => {
            if (e.required) {
                slashCommand.addChannelOption(f =>
                    f.setName(e.name)
                    .setDescription(e.description)
                    .setRequired(e.required)
                    .addChannelTypes(ChannelType.GuildText)
                    .addChannelTypes(ChannelType.GuildVoice)
                    .addChannelTypes(ChannelType.PublicThread)
                    .addChannelTypes(ChannelType.GuildForum)
                );
            }
        });
    }
    if (config.options.string) {
        config.options.string.forEach(e => {
            if (e.required) {
                if (e.choices) {
                    slashCommand.addStringOption(f =>
                        f.setName(e.name)
                        .setDescription(e.description)
                        .setRequired(e.required)
                        .addChoices(...(e.choices) ?? [])
                    );
                }
                else {
                    slashCommand.addStringOption(f =>
                        f.setName(e.name)
                        .setDescription(e.description)
                        .setRequired(e.required)
                    );
                }
            }
        });
    }
    if (config.options.number) {
        config.options.number.forEach(e => {
            if (e.required) {
                slashCommand.addIntegerOption(f => 
                    f.setName(e.name)
                    .setDescription(e.description)
                    .setRequired(e.required)
                );
            }
        });
    }
    if (config.options.attachment) {
        config.options.attachment.forEach(e => {
            if (e.required) {
                slashCommand.addAttachmentOption(f =>
                    f.setName(e.name)
                    .setDescription(e.description)
                    .setRequired(e.required)
                );
            }
        });
    }

    // build optional options
    if (config.options.user) {
        config.options.user.forEach(e => {
            if (!e.required) {
                slashCommand.addUserOption(f =>
                    f.setName(e.name)
                    .setDescription(e.description)
                    .setRequired(e.required)
                );
            }
        });
    }
    if (config.options.channel) {
        config.options.channel.forEach(e => {
            if (!e.required) {
                slashCommand.addChannelOption(f =>
                    f.setName(e.name)
                    .setDescription(e.description)
                    .setRequired(e.required)
                    .addChannelTypes(ChannelType.GuildText)
                    .addChannelTypes(ChannelType.GuildVoice)
                    .addChannelTypes(ChannelType.PublicThread)
                    .addChannelTypes(ChannelType.GuildForum)
                );
            }
        });
    }
    if (config.options.string) {
        config.options.string.forEach(e => {
            if (!e.required) {
                if (e.choices) {
                    slashCommand.addStringOption(f =>
                        f.setName(e.name)
                        .setDescription(e.description)
                        .setRequired(e.required)
                        .addChoices(...(e.choices) ?? [])
                    );
                }
                else {
                    slashCommand.addStringOption(f =>
                        f.setName(e.name)
                        .setDescription(e.description)
                        .setRequired(e.required)
                    );
                }
            }
        });
    }
    if (config.options.number) {
        config.options.number.forEach(e => {
            if (!e.required) {
                slashCommand.addIntegerOption(f => 
                    f.setName(e.name)
                    .setDescription(e.description)
                    .setRequired(e.required)
                );
            }
        });
    }
    if (config.options.attachment) {
        config.options.attachment.forEach(e => {
            if (!e.required) {
                slashCommand.addAttachmentOption(f =>
                    f.setName(e.name)
                    .setDescription(e.description)
                    .setRequired(e.required)
                );
            }
        });
    }

    return slashCommand.toJSON()
}