import { 
    ButtonStyle,
    ChannelType,
    Message
} from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, SlashCommandBuilder } from '@discordjs/builders';
import { 
    Command
} from '@dcbotTypes';

interface ButtonConfig {
    customId: string;
    label: string;
    style?: ButtonStyle;
}

export const buildButtonRows = (button_config: ButtonConfig[]) => {
    const buttons: ButtonBuilder[] = button_config.map(button => {
        return new ButtonBuilder()
            .setCustomId(button.customId)
            .setLabel(button.label)
            .setStyle(button.style || ButtonStyle.Primary);
    });

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
    }

    return rows;
}

export const buildSlashCommands = (config: Command) => {
    const slashCommand = new SlashCommandBuilder()
        .setName(config.name)
        .setDescription(config.description);

    if (!config.options) return slashCommand.toJSON();

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

export const msgReact = async (msg: Message, reactions: string[]) => {
    if (!msg || !reactions || reactions.length === 0) return;

    for (const reaction of reactions) {
        try {
            await msg.react(reaction);
        } catch (error) {
            console.error(`Failed to react with ${reaction} on message ${msg.id}:`, error);
        }
    }
}