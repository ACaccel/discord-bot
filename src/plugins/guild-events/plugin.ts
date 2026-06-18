/**
 * GuildEventsPlugin — mirrors message edits/deletes and role changes
 * to a guild's configured `event` channel.
 *
 * Behaviours:
 *   - `messageUpdate`: if the bot's guild has an `event` channel and
 *     the content actually changed, send an embed describing the diff.
 *   - `messageDelete`: same shape; attaches images / non-image file
 *     URLs separately.
 *   - `guildMemberUpdate`: when role membership changes, send a role-
 *     delta embed (added / removed).
 *   - `guildCreate`: when the bot joins a new guild, onboard it
 *     (connect its per-guild database, register slash commands)
 *     through the typed {@link GuildOnboardingPort} resolved from the
 *     IoC container, so no plugin code reaches into `BaseBot`
 *     internals.
 *
 * Channel suppression ("only mirror rank-0 channels") is no longer baked
 * into the plugin: the handlers resolve the {@link PermissionRankPolicy}
 * from `ctx` at event time and ask it whether the `guild_events` feature is
 * suppressed for the message's channel. A no-arg factory (consistent with
 * the sibling `createGiveawayPlugin()` / `createActivityPlugin()`) keeps the
 * returned object pure data.
 */
import {
  EmbedBuilder,
  type Guild,
  type Message,
  type PartialMessage,
  type TextChannel,
} from 'discord.js';

import { TOKENS } from '../../core/plugin';
import type { GuildRegistry } from '../../core/guild-registry';
import type { Plugin } from '../../core/plugin';
import type { GuildOnboardingPort, PermissionRankPolicy } from '../../core/plugin';
import { logError, logGuildEvent, logSystem, type Logger } from '../../core/logger';
import { archiveDeletedAttachment, parentChannelIdOf } from '../../infra/discord';

const PLUGIN_ID = 'guild-events';
const PLUGIN_VERSION = '1.0.0';
const EVENT_CHANNEL = 'event';
const MAX_MESSAGE_PREVIEW = 1000;

const truncate = (text: string): string =>
  text.length > MAX_MESSAGE_PREVIEW ? `${text.slice(0, MAX_MESSAGE_PREVIEW)}...` : text;

const resolveEventChannel = (
  registry: GuildRegistry,
  guildId: string,
): TextChannel | undefined => {
  const channel = registry.getChannel(guildId, EVENT_CHANNEL);
  if (channel === undefined) return undefined;
  // Use `isSendable()` — discord.js's narrowing predicate models
  // exactly the "this channel accepts .send" capability the embed
  // mirror needs.
  return channel.isSendable() ? (channel as TextChannel) : undefined;
};

/**
 * Mirror an embed to the event channel, swallowing send failures so a
 * misconfigured channel (perms revoked, channel deleted between cache
 * read and send) never suppresses the audit-log side effects that
 * follow. Without the swallow, a Discord-side rejection here would
 * abort the surrounding handler before the audit-log writes ran.
 *
 * The bot tag on the structured error line is ambient via the
 * logger's base bindings (`createBootstrapLogger` attaches `{ bot }`),
 * so no `clientId` parameter is threaded through.
 */
const safeSendEmbed = async (
  channel: TextChannel,
  embed: EmbedBuilder,
  logger: Logger | undefined,
  guildId: string,
  context: string,
): Promise<void> => {
  try {
    await channel.send({ embeds: [embed] });
  } catch (err: unknown) {
    logError(
      logger,
      guildId,
      new Error(`guild-events: failed to mirror ${context} embed: ${String(err)}`),
    );
  }
};

/** Build the guild-events plugin. Takes no config; suppression is resolved
 * per-event from {@link PermissionRankPolicy}. */
export const createGuildEventsPlugin = (): Plugin => {
  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    critical: false,

    events: {
      messageUpdate: async (ctx, oldMessage, newMessage) => {
        await handleMessageUpdate(
          ctx.resolve(TOKENS.GuildRegistry),
          ctx.resolve(TOKENS.PermissionRankPolicy),
          ctx.resolve(TOKENS.Logger),
          oldMessage,
          newMessage,
        );
      },
      messageDelete: async (ctx, message) => {
        await handleMessageDelete(
          ctx.resolve(TOKENS.GuildRegistry),
          ctx.resolve(TOKENS.PermissionRankPolicy),
          ctx.resolve(TOKENS.Logger),
          message,
        );
      },
      guildCreate: async (ctx, guild) => {
        await handleGuildCreate(
          ctx.resolve(TOKENS.GuildOnboardingPort),
          ctx.resolve(TOKENS.Logger),
          guild,
        );
      },
      guildMemberUpdate: async (ctx, oldMember, newMember) => {
        const guildId = newMember.guild.id;
        const logger = ctx.resolve(TOKENS.Logger);
        const eventChannel = resolveEventChannel(ctx.resolve(TOKENS.GuildRegistry), guildId);
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        const addedRoles = newRoles.filter((role) => !oldRoles.has(role.id));
        const removedRoles = oldRoles.filter((role) => !newRoles.has(role.id));
        if (addedRoles.size === 0 && removedRoles.size === 0) return;
        if (oldMember.partial) await oldMember.fetch();
        if (newMember.partial) await newMember.fetch();
        const addedRolesList = addedRoles.map((role) => `<@&${role.id}>`).join(', ');
        const removedRolesList = removedRoles.map((role) => `<@&${role.id}>`).join(', ');
        const addedRoleMentions = addedRoles.map((role) => `<@&${role.id}>`);
        const removedRoleMentions = removedRoles.map((role) => `<@&${role.id}>`);
        if (eventChannel !== undefined) {
          const embed = new EmbedBuilder()
            .setColor(0x0000ff)
            .setTitle('Role Update')
            .setAuthor({
              name: newMember.user.username,
              iconURL: newMember.user.displayAvatarURL(),
            })
            .addFields(
              { name: 'user', value: `<@${newMember.user.id}>`, inline: true },
              {
                name: 'added roles',
                value: addedRolesList.length > 0 ? addedRolesList : 'No roles added',
                inline: true,
              },
              {
                name: 'removed roles',
                value: removedRolesList.length > 0 ? removedRolesList : 'No roles removed',
                inline: true,
              },
            )
            .setTimestamp();
          await safeSendEmbed(eventChannel, embed, logger, guildId, 'guild_member_update');
        }
        // Audit-log line, decoupled from the embed write so a missing
        // `event` channel does not suppress the audit trail.
        logGuildEvent(
          logger,
          guildId,
          'guild_member_update',
          {
            user: newMember.user.username,
            added: addedRoleMentions,
            removed: removedRoleMentions,
          },
          newMember.guild.name,
        );
      },
    },
  };
};

const handleMessageUpdate = async (
  registry: GuildRegistry,
  policy: PermissionRankPolicy,
  logger: Logger | undefined,
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> => {
  // Guards: skip when either content side is missing, identical, or
  // the author / guild is unresolvable. These also filter the
  // partial-message edge that pre-cache messages emit. The guild guard
  // runs before the rank check so a guild id is in hand for the policy.
  if (oldMessage.content === null || oldMessage.content === undefined) return;
  if (newMessage.content === null || newMessage.content === undefined) return;
  if (oldMessage.content === newMessage.content) return;
  if (newMessage.guild === null || newMessage.guildId === null) return;
  if (newMessage.author === null || oldMessage.author === null) return;
  if (newMessage.author.bot) return;
  // Suppress the whole mirror (embed AND audit) for channels above the
  // guild_events rank ceiling — the feature "only records rank-0 channels".
  if (
    policy.isSuppressed(
      newMessage.guildId,
      'guild_events',
      oldMessage.channel.id,
      parentChannelIdOf(oldMessage.channel),
    )
  ) {
    return;
  }
  if (oldMessage.partial) await oldMessage.fetch();
  if (newMessage.partial) await newMessage.fetch();

  const eventChannel = resolveEventChannel(registry, newMessage.guildId);
  if (eventChannel !== undefined) {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Message Updated')
      .setAuthor({
        name: newMessage.author.displayName,
        iconURL: newMessage.author.displayAvatarURL(),
      })
      .addFields(
        { name: 'author', value: `<@${newMessage.author.id}>`, inline: true },
        { name: 'channel', value: `<#${newMessage.channel.id}>`, inline: true },
        { name: 'old message', value: truncate(oldMessage.content), inline: false },
        { name: 'new message', value: truncate(newMessage.content), inline: false },
      )
      .setTimestamp();
    await safeSendEmbed(eventChannel, embed, logger, newMessage.guildId, 'message_update');
  }

  // Audit-log side effect — emitted independently of the embed so a
  // missing `event` channel does not suppress the audit trail.
  // `?.name` tolerates a channel missing from the cache.
  const channelName = newMessage.guild.channels.cache.get(newMessage.channel.id)?.name;
  logGuildEvent(
    logger,
    newMessage.guildId,
    'message_update',
    {
      user: newMessage.author.username,
      channel: channelName ?? '<unknown>',
      oldMessage: oldMessage.content,
      newMessage: newMessage.content,
    },
    newMessage.guild.name,
  );
};

const handleMessageDelete = async (
  registry: GuildRegistry,
  policy: PermissionRankPolicy,
  logger: Logger | undefined,
  message: Message | PartialMessage,
): Promise<void> => {
  if (message.guild === null || message.guildId === null) return;
  if (message.author === null) return;
  if (message.author.bot) return;
  // Suppress the whole mirror (embed AND audit) for channels above the
  // guild_events rank ceiling — the feature "only records rank-0 channels".
  if (
    policy.isSuppressed(
      message.guildId,
      'guild_events',
      message.channel.id,
      parentChannelIdOf(message.channel),
    )
  ) {
    return;
  }
  if (message.partial) await message.fetch();

  const eventChannel = resolveEventChannel(registry, message.guildId);
  const content =
    message.content === null || message.content === undefined || message.content.length === 0
      ? 'No content'
      : truncate(message.content);

  if (eventChannel !== undefined) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('Message Deleted')
      .setAuthor({
        name: message.author.displayName,
        iconURL: message.author.displayAvatarURL(),
      })
      .addFields(
        { name: 'author', value: `<@${message.author.id}>`, inline: true },
        { name: 'channel', value: `<#${message.channel.id}>`, inline: true },
        { name: 'message', value: content, inline: false },
      )
      .setTimestamp();
    if (message.attachments.size > 0) {
      message.attachments.forEach((attachment) => {
        if (attachment.contentType === null) return;
        if (attachment.contentType.includes('image')) {
          embed.setImage(attachment.url);
        } else {
          embed.addFields({ name: 'attachment', value: attachment.url, inline: false });
        }
      });
    }
    await safeSendEmbed(eventChannel, embed, logger, message.guildId, 'message_delete');
  }

  // Forensic attachment download — runs for every attachment,
  // including images that the embed separately previews.
  // Fire-and-forget; the helper has its own internal try/catch so a
  // failed save does not break the audit log below.
  if (message.attachments.size > 0) {
    message.attachments.forEach((attachment) => {
      void archiveDeletedAttachment(logger, message.guildId as string, attachment);
    });
  }

  // Audit-log side effect — emitted regardless of event-channel
  // presence so deletions are traceable when the mirror is offline.
  const channelName = message.guild.channels.cache.get(message.channel.id)?.name;
  const attachmentUrls = message.attachments.map((a) => a.url);
  const details: Record<string, unknown> = {
    user: message.author.username,
    channel: channelName ?? '<unknown>',
    message: message.content ?? '',
  };
  if (attachmentUrls.length > 0) {
    details['attachments'] = attachmentUrls;
  }
  logGuildEvent(logger, message.guildId, 'message_delete', details, message.guild.name);
};

/**
 * Onboard a freshly joined guild through the {@link GuildOnboardingPort}.
 *
 * The port owns the two infrastructure actions a new guild needs —
 * connecting its per-guild database and registering the bot's slash
 * commands. The plugin merely resolves the port and invokes it, so no
 * plugin code reaches into `BaseBot` internals.
 *
 * A failed onboarding is caught and logged rather than rethrown: the
 * dispatcher already isolates subscription failures, but onboarding is
 * a structural side effect (not user-facing) and the structured
 * operator log is the actionable record. Letting it escape would only
 * produce a less-contextual dispatcher-level error line.
 */
const handleGuildCreate = async (
  onboardingPort: GuildOnboardingPort,
  logger: Logger | undefined,
  guild: Guild,
): Promise<void> => {
  try {
    await onboardingPort.onboardGuild(guild.id);
    // Promoted from `logSystem` to `logGuildEvent` so the file sink
    // files it under `logs/<bot>/<guildId>/` rather than the bot-root
    // directory — the line is per-guild by definition.
    logGuildEvent(
      logger,
      guild.id,
      'guild_create',
      {
        guildId: guild.id,
        ownerId: guild.ownerId,
        memberCount: guild.memberCount,
      },
      guild.name,
    );
  } catch (err: unknown) {
    logSystem(
      logger,
      `guild-events: failed to onboard guild ${guild.name} (${guild.id}): ${String(err)}`,
    );
  }
};

/** Test-only access. Not part of the plugin's public API. */
export const __test = { safeSendEmbed, handleGuildCreate };
