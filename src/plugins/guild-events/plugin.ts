/**
 * GuildEventsPlugin — mirrors message edits/deletes and role changes
 * to a guild's configured `event` channel.
 *
 * Behaviours migrated verbatim from `src/events/guild_event.ts`:
 *   - `messageUpdate`: if the bot's guild has an `event` channel and
 *     the content actually changed, send an embed describing the diff.
 *   - `messageDelete`: same shape; attaches images / non-image file
 *     URLs separately.
 *   - `guildMemberUpdate`: when role membership changes, send a role-
 *     delta embed (added / removed).
 *
 * Why a factory (`createGuildEventsPlugin(config)`) rather than a
 * plain `Plugin` const: the per-bot `blockedChannels` list lives in
 * the bot's `config.json` and must be captured into closures the
 * event handlers can read. The plugin's `events.messageUpdate(ctx,
 * ...)` signature does not carry the typed config (only `init` does),
 * so the cleanest production-grade option is a factory whose closures
 * encapsulate config. This keeps the plugin object pure-data
 * once produced and avoids module-scoped mutable state.
 */
import { EmbedBuilder, type Message, type PartialMessage, type TextChannel } from 'discord.js';
import { z } from 'zod';

import { TOKENS } from '../../core/ioc';
import type { GuildRegistry } from '../../core/guild-registry';
import type { Plugin } from '../../core/plugin';
// Import directly from the leaf module (not the barrel) so the strict
// typecheck does not transitively pull the legacy `utils/misc.ts` and
// `utils/bot_cmd.ts` files, which still use `@bot` / `@cmd` path
// aliases not present in `tsconfig.strict.json`. `utils/logger.ts`
// itself was rewritten as a strict-clean shim in Phase 3.
import { logError, logGuildEvent, type Logger } from '../../core/logger';
import { archiveDeletedAttachment } from '../../infra/discord';

const PLUGIN_ID = 'guild-events';
const PLUGIN_VERSION = '1.0.0';
const EVENT_CHANNEL = 'event';
const MAX_MESSAGE_PREVIEW = 1000;

const ConfigSchema = z
  .object({
    /**
     * Channel ids whose `messageUpdate` / `messageDelete` events the
     * plugin must suppress. The list also matches a message's parent
     * channel (thread parent) so threads under a blocked forum are
     * silenced too. Empty = mirror everything.
     */
    blockedChannels: z.array(z.string()).default([]),
    /**
     * The host bot's Discord client id. Required because the legacy
     * audit-log path (`logger.guildLogger`) tags every line with the
     * emitting bot; preserving that side-effect verbatim is part of
     * the Phase 4b behaviour contract. Passed in by the composition
     * root rather than resolved at runtime so the plugin stays
     * decoupled from BaseBot.
     */
    clientId: z.string().min(1),
  })
  .strict();

export type GuildEventsConfig = z.infer<typeof ConfigSchema>;

const truncate = (text: string): string =>
  text.length > MAX_MESSAGE_PREVIEW ? `${text.slice(0, MAX_MESSAGE_PREVIEW)}...` : text;

const isBlocked = (
  channelId: string,
  parentId: string | null | undefined,
  blocked: readonly string[],
): boolean => {
  if (blocked.length === 0) return false;
  if (blocked.includes(channelId)) return true;
  return parentId !== null && parentId !== undefined && blocked.includes(parentId);
};

const resolveEventChannel = (
  registry: GuildRegistry,
  guildId: string,
): TextChannel | undefined => {
  const channel = registry.getChannel(guildId, EVENT_CHANNEL);
  if (channel === undefined) return undefined;
  // Use `isSendable()` — discord.js's narrowing predicate models
  // exactly the "this channel accepts .send" capability the embed
  // mirror needs. Direct cast avoids the previous `'send' in channel`
  // duck-type pattern.
  return channel.isSendable() ? (channel as TextChannel) : undefined;
};

/**
 * Mirror an embed to the event channel, swallowing send failures so a
 * misconfigured channel (perms revoked, channel deleted between cache
 * read and send) never suppresses the audit-log side effects that
 * follow. Replicates the legacy `logger.channelLogger` swallowing
 * behaviour; without it a Discord-side rejection here would abort the
 * surrounding handler before `guildLogger` / `attachmentLogger` ran.
 *
 * `clientId` is threaded in so the structured error line is tagged
 * with the originating bot, matching the rest of this plugin's audit
 * surface.
 */
const safeSendEmbed = async (
  channel: TextChannel,
  embed: EmbedBuilder,
  logger: Logger | undefined,
  clientId: string,
  guildId: string,
  context: string,
): Promise<void> => {
  try {
    await channel.send({ embeds: [embed] });
  } catch (err: unknown) {
    logError(
      logger,
      clientId,
      guildId,
      new Error(`guild-events: failed to mirror ${context} embed: ${String(err)}`),
    );
  }
};

/**
 * Build a plugin instance with `blockedChannels` baked into closures.
 *
 * The factory validates `rawConfig` here (rather than letting the host
 * do it via `configSchema`) because the returned Plugin object has its
 * config inlined into closures — the host's register-time path never
 * needs to re-validate. Producing a `Plugin<void>` keeps the typing
 * crisp and sidesteps the `ZodObject` / `ZodType` invariance pitfall
 * that arises when a schema with `.default()` widens the input shape.
 */
export const createGuildEventsPlugin = (rawConfig: unknown): Plugin => {
  const config = ConfigSchema.parse(rawConfig);
  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    critical: false,

    events: {
      messageUpdate: async (ctx, oldMessage, newMessage) => {
        await handleMessageUpdate(
          ctx.resolve(TOKENS.GuildRegistry),
          ctx.resolve(TOKENS.Logger),
          config.blockedChannels,
          config.clientId,
          oldMessage,
          newMessage,
        );
      },
      messageDelete: async (ctx, message) => {
        await handleMessageDelete(
          ctx.resolve(TOKENS.GuildRegistry),
          ctx.resolve(TOKENS.Logger),
          config.blockedChannels,
          config.clientId,
          message,
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
          await safeSendEmbed(eventChannel, embed, logger, config.clientId, guildId, 'guild_member_update');
        }
        // Audit-log line preserved verbatim from legacy
        // `detectGuildMemberUpdate`. Decoupled from the embed write so
        // a missing `event` channel does not suppress the audit trail.
        const log = `User: ${newMember.user.username}, Added: ${addedRolesList}, Removed: ${removedRolesList}`;
        logGuildEvent(
          logger,
          config.clientId,
          guildId,
          'guild_member_update',
          log,
          newMember.guild.name,
        );
      },
    },
  };
};

/** Test-only access. Not part of the plugin's public API. */
export const __test = { safeSendEmbed };

const handleMessageUpdate = async (
  registry: GuildRegistry,
  logger: Logger | undefined,
  blockedChannels: readonly string[],
  clientId: string,
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> => {
  const parentId = (oldMessage.channel as TextChannel).parentId;
  if (isBlocked(oldMessage.channel.id, parentId, blockedChannels)) return;

  // Legacy guards preserved exactly: skip when either content side is
  // missing, identical, or the author / guild is unresolvable. These
  // also filter the partial-message edge that pre-cache messages emit.
  if (oldMessage.content === null || oldMessage.content === undefined) return;
  if (newMessage.content === null || newMessage.content === undefined) return;
  if (oldMessage.content === newMessage.content) return;
  if (newMessage.guild === null || newMessage.guildId === null) return;
  if (newMessage.author === null || oldMessage.author === null) return;
  if (newMessage.author.bot) return;
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
    await safeSendEmbed(eventChannel, embed, logger, clientId, newMessage.guildId, 'message_update');
  }

  // Audit-log side effect from legacy `detectMessageUpdate` — emitted
  // independently of the embed so a missing `event` channel does not
  // suppress the audit trail. `?.name` mirrors the legacy nullable
  // chain on the channel cache.
  const channelName = newMessage.guild.channels.cache.get(newMessage.channel.id)?.name;
  const log =
    `User: ${newMessage.author.username}, Channel: ${channelName ?? '<unknown>'}, ` +
    `Old: ${oldMessage.content}, New: ${newMessage.content}`;
  logGuildEvent(
    logger,
    clientId,
    newMessage.guildId,
    'message_update',
    log,
    newMessage.guild.name,
  );
};

const handleMessageDelete = async (
  registry: GuildRegistry,
  logger: Logger | undefined,
  blockedChannels: readonly string[],
  clientId: string,
  message: Message | PartialMessage,
): Promise<void> => {
  const parentId = (message.channel as TextChannel).parentId;
  if (isBlocked(message.channel.id, parentId, blockedChannels)) return;
  if (message.guild === null || message.guildId === null) return;
  if (message.author === null) return;
  if (message.author.bot) return;
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
    await safeSendEmbed(eventChannel, embed, logger, clientId, message.guildId, 'message_delete');
  }

  // Forensic attachment download (legacy `detectMessageDelete` ran
  // this for EVERY attachment, including images that the embed
  // separately previews). Fire-and-forget; the helper has its own
  // internal try/catch so a failed save does not break the audit
  // log below.
  if (message.attachments.size > 0) {
    message.attachments.forEach((attachment) => {
      void archiveDeletedAttachment(logger, message.guildId as string, attachment);
    });
  }

  // Audit-log side effect — emitted regardless of event-channel
  // presence so deletions are traceable when the mirror is offline.
  const channelName = message.guild.channels.cache.get(message.channel.id)?.name;
  const log =
    `User: ${message.author.username}, Channel: ${channelName ?? '<unknown>'}, ` +
    `Message: ${message.content ?? ''}`;
  logGuildEvent(logger, clientId, message.guildId, 'message_delete', log, message.guild.name);
};
