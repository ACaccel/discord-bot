import {
  ApplicationCommandType,
  ChannelType,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import { ContextMenuCommandBuilder, SlashCommandBuilder } from '@discordjs/builders';
import type { LocalizedCommandConfig, LocalizedCommandOption } from './command';

/**
 * Translates a {@link LocalizedCommandConfig} into the Discord REST JSON
 * payload for command registration.
 *
 * Consumed both at deploy time (`src/deploy.ts`) and at runtime command
 * registration (`getCommandJsonBody`). It lives next to `command.ts`
 * because it operates purely on the localised command-metadata contract.
 */
export const buildCommandJsonBody = (
  config: LocalizedCommandConfig,
): RESTPostAPIApplicationCommandsJSONBody => {
  // Context menu commands carry no description / options.
  if (
    config.type === ApplicationCommandType.User ||
    config.type === ApplicationCommandType.Message
  ) {
    return new ContextMenuCommandBuilder().setName(config.name).setType(config.type).toJSON();
  }

  const slashCommand = new SlashCommandBuilder()
    .setName(config.name)
    .setDescription(config.description);

  if (!config.options) return slashCommand.toJSON();

  const channelTypes = [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.AnnouncementThread,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
  ] as const;

  const optionHandlers = {
    user: (e: LocalizedCommandOption) =>
      slashCommand.addUserOption((o) =>
        o.setName(e.name).setDescription(e.description).setRequired(e.required),
      ),

    channel: (e: LocalizedCommandOption) =>
      slashCommand.addChannelOption((o) =>
        o
          .setName(e.name)
          .setDescription(e.description)
          .setRequired(e.required)
          .addChannelTypes(...channelTypes),
      ),

    string: (e: LocalizedCommandOption) =>
      slashCommand.addStringOption((o) => {
        o.setName(e.name).setDescription(e.description).setRequired(e.required);
        if (e.choices) {
          o.addChoices(...e.choices);
        }
        return o;
      }),

    number: (e: LocalizedCommandOption) =>
      slashCommand.addIntegerOption((o) => {
        o.setName(e.name).setDescription(e.description).setRequired(e.required);
        if (typeof e.min === 'number') o.setMinValue(e.min);
        if (typeof e.max === 'number') o.setMaxValue(e.max);
        return o;
      }),

    float: (e: LocalizedCommandOption) =>
      slashCommand.addNumberOption((o) => {
        o.setName(e.name).setDescription(e.description).setRequired(e.required);
        if (typeof e.min === 'number') o.setMinValue(e.min);
        if (typeof e.max === 'number') o.setMaxValue(e.max);
        return o;
      }),

    attachment: (e: LocalizedCommandOption) =>
      slashCommand.addAttachmentOption((o) =>
        o.setName(e.name).setDescription(e.description).setRequired(e.required),
      ),
  } as const;

  // Discord requires required options to precede optional ones.
  const allOptions: { type: keyof typeof optionHandlers; data: LocalizedCommandOption }[] = [];
  for (const [type, options] of Object.entries(config.options)) {
    const handler = optionHandlers[type as keyof typeof optionHandlers];
    if (!handler) continue;

    options.forEach((opt) =>
      allOptions.push({ type: type as keyof typeof optionHandlers, data: opt }),
    );
  }

  allOptions
    .sort((a, b) => Number(b.data.required) - Number(a.data.required))
    .forEach(({ type, data }) => {
      optionHandlers[type](data);
    });

  return slashCommand.toJSON();
};
