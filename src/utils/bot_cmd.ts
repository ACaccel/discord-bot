import { 
    ApplicationCommandType,
    ButtonStyle,
    ChannelType,
    Message
} from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ContextMenuCommandBuilder, SlashCommandBuilder } from '@discordjs/builders';
import {
    CommandConfig
} from '@cmd';

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

export const buildCommandJsonBody = (config: CommandConfig) => {
    // Context menu
    if (
        config.type === ApplicationCommandType.User ||
        config.type === ApplicationCommandType.Message
    ) {
        return new ContextMenuCommandBuilder()
            .setName(config.name)
            .setType(config.type)
            .toJSON();
    }

    const slashCommand = new SlashCommandBuilder()
        .setName(config.name)
        .setDescription(config.description);

    if (!config.options) return slashCommand.toJSON();

    const channelTypes = [
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.PublicThread,
        ChannelType.GuildForum,
    ] as const;    

    const optionHandlers = {
        user: (e: any) =>
            slashCommand.addUserOption(o =>
                o.setName(e.name)
                 .setDescription(e.description)
                 .setRequired(e.required)
            ),

        channel: (e: any) =>
            slashCommand.addChannelOption(o =>
                o.setName(e.name)
                 .setDescription(e.description)
                 .setRequired(e.required)
                 .addChannelTypes(...channelTypes)
            ),

        string: (e: any) =>
            slashCommand.addStringOption(o => {
                o.setName(e.name)
                 .setDescription(e.description)
                 .setRequired(e.required);

                if (e.choices) {
                    o.addChoices(...e.choices);
                }
                return o;
            }),

        number: (e: any) =>
            slashCommand.addIntegerOption(o =>
                o.setName(e.name)
                 .setDescription(e.description)
                 .setRequired(e.required)
            ),

        attachment: (e: any) =>
            slashCommand.addAttachmentOption(o =>
                o.setName(e.name)
                 .setDescription(e.description)
                 .setRequired(e.required)
            )
    } as const;

    // required first, optional second
    const allOptions: { type: keyof typeof optionHandlers; data: any }[] = [];
    for (const [type, options] of Object.entries(config.options)) {
        const handler = optionHandlers[type as keyof typeof optionHandlers];
        if (!handler) continue;

        options.forEach(opt =>
            allOptions.push({ type: type as keyof typeof optionHandlers, data: opt })
        );
    }

allOptions
    .sort((a, b) => Number(b.data.required) - Number(a.data.required))
    .forEach(({ type, data }) => {
        optionHandlers[type](data);
    });


    return slashCommand.toJSON();
};

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