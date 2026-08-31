/**
 * GuildEventsPlugin — mirrors message edits/deletes and role changes
 * to a guild's configured `event` channel.
 *
 * Behaviours:
 *   - `messageUpdate`: when the content actually changed, record the edit
 *     locally and — unless rank-suppressed — mirror an embed describing the
 *     diff to the `event` channel.
 *   - `messageDelete`: same shape; the embed attaches images / non-image
 *     file URLs separately, and every attachment is archived to disk.
 *   - `guildMemberUpdate`: when role membership changes, send a role-
 *     delta embed (added / removed).
 *   - `guildCreate`: when the bot joins a new guild, onboard it
 *     (connect its per-guild database, register slash commands)
 *     through the typed {@link GuildOnboardingPort} resolved from the
 *     IoC container, so no plugin code reaches into `BaseBot`
 *     internals.
 *
 * Dependencies are resolved once in `init` into a typed bundle the event
 * subscriptions close over, rather than per event.
 *
 * Rank gates DISCLOSURE only. For `messageUpdate` / `messageDelete` the
 * handlers ask the {@link PermissionRankPolicy} whether the `guild_events`
 * feature is suppressed for the message's
 * channel. Suppression withholds the Discord `event`-channel embed, but the
 * local record — the `logGuildEvent` audit line and `archiveDeletedAttachments`
 * forensic download — runs UNCONDITIONALLY for every non-bot guild message.
 * Private (rank-1+) channels are therefore fully recorded server-side yet
 * never mirrored to Discord. A no-arg factory (consistent with the sibling
 * `createGiveawayPlugin()` / `createActivityPlugin()`) keeps the returned
 * object pure data.
 */
import {
  EmbedBuilder,
  type Guild,
  type Message,
  type PartialMessage,
  type TextChannel,
} from 'discord.js';

import { TOKENS } from '../../bot/tokens';
import type { GuildRegistry } from '../../bot/guild-registry';
import type { Plugin } from '../../core/plugin';
import type { GuildOnboardingPort, PermissionRankPolicy } from '../../core/plugin';
import { logError, logGuildEvent, logSystem, type Logger } from '../../core/logger';
import { archiveDeletedAttachments, ancestorChannelIdsOf } from '../../infra/discord';

const PLUGIN_ID = 'guild-events';
const PLUGIN_VERSION = '1.0.0';
const EVENT_CHANNEL = 'event';
const MAX_MESSAGE_PREVIEW = 1000;

const truncate = (text: string): string =>
  text.length > MAX_MESSAGE_PREVIEW ? `${text.slice(0, MAX_MESSAGE_PREVIEW)}...` : text;

const resolveEventChannel = (registry: GuildRegistry, guildId: string): TextChannel | undefined => {
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

/** Everything the event handlers read, resolved once in `init`. */
interface GuildEventsDeps {
  readonly registry: GuildRegistry;
  readonly policy: PermissionRankPolicy;
  readonly onboardingPort: GuildOnboardingPort;
  /** The bot-root logger, not the plugin child: audit lines are per-guild. */
  readonly logger: Logger;
}

/** Build the guild-events plugin. Takes no config; suppression is decided
 * per event by the {@link PermissionRankPolicy} resolved in `init`. */
export const createGuildEventsPlugin = (): Plugin => {
  let resolved: GuildEventsDeps | undefined;
  /** See the `init` contract in `core/plugin/types.ts`: unreachable. */
  const deps = (): GuildEventsDeps => {
    if (resolved === undefined) {
      throw new TypeError('guild-events: event dispatched before init resolved dependencies');
    }
    return resolved;
  };

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,

    async init(ctx): Promise<void> {
      resolved = {
        registry: ctx.resolve(TOKENS.GuildRegistry),
        policy: ctx.resolve(TOKENS.PermissionRankPolicy),
        onboardingPort: ctx.resolve(TOKENS.GuildOnboardingPort),
        logger: ctx.resolve(TOKENS.Logger),
      };
    },

    events: {
      messageUpdate: async (_ctx, oldMessage, newMessage) => {
        const { registry, policy, logger } = deps();
        await handleMessageUpdate(registry, policy, logger, oldMessage, newMessage);
      },
      messageDelete: async (_ctx, message) => {
        const { registry, policy, logger } = deps();
        await handleMessageDelete(registry, policy, logger, message);
      },
      guildCreate: async (_ctx, guild) => {
        const { onboardingPort, logger } = deps();
        await handleGuildCreate(onboardingPort, logger, guild);
      },
      guildMemberUpdate: async (_ctx, oldMember, newMember) => {
        const { registry, logger } = deps();
        const guildId = newMember.guild.id;
        const eventChannel = resolveEventChannel(registry, guildId);
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

/**
 * Hydrate a partial message, tolerating a fetch rejection. A deleted
 * message's `fetch()` rejects with `Unknown Message`; swallowing it (after an
 * error line) lets the unconditional local-record path still run on whatever
 * the cache held, rather than aborting the whole handler. On `messageUpdate`
 * the content guards already ran before this call, so there the tolerance
 * covers attachment hydration rather than content. The narrowing of `guildId`
 * to a string is the caller's responsibility (the guards run first).
 */
const fetchPartialMessage = async (
  message: Message | PartialMessage,
  logger: Logger | undefined,
  guildId: string,
): Promise<void> => {
  if (!message.partial) return;
  try {
    await message.fetch();
  } catch (err: unknown) {
    logError(logger, guildId, err);
  }
};

const handleMessageUpdate = async (
  registry: GuildRegistry,
  policy: PermissionRankPolicy,
  logger: Logger | undefined,
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> => {
  // Relevance guards: skip when either content side is missing, identical, or
  // the author / guild is unresolvable. These also filter the partial-message
  // edge that pre-cache messages emit. They are relevance filters ("is there a
  // textual change worth recording at all"), not disclosure filters, so they
  // stay BEFORE the rank check; the guild guard also puts a guild id in hand.
  if (oldMessage.content === null || oldMessage.content === undefined) return;
  if (newMessage.content === null || newMessage.content === undefined) return;
  if (oldMessage.content === newMessage.content) return;
  if (newMessage.guild === null || newMessage.guildId === null) return;
  if (newMessage.author === null || oldMessage.author === null) return;
  if (newMessage.author.bot) return;

  // Hydrate partials before recording so the local audit captures full content
  // even for channels the embed mirror will skip.
  await fetchPartialMessage(oldMessage, logger, newMessage.guildId);
  await fetchPartialMessage(newMessage, logger, newMessage.guildId);

  // Rank gates DISCLOSURE only: a channel above the `guild_events` ceiling is
  // withheld from the Discord `event` channel but still recorded locally below.
  const suppressed = policy.isSuppressed(
    newMessage.guildId,
    'guild_events',
    oldMessage.channel.id,
    ancestorChannelIdsOf(oldMessage.channel, oldMessage.guild?.channels.cache),
  );

  if (!suppressed) {
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
  }

  // Local audit record — unconditional, regardless of rank or event-channel
  // presence. Stable ids (`userId` / `channelId` / `messageId`) make the line
  // independently usable, since display / channel names change and collide.
  // `?.name` tolerates a channel missing from the cache.
  const channelName = newMessage.guild.channels.cache.get(newMessage.channel.id)?.name;
  const details: Record<string, unknown> = {
    user: newMessage.author.username,
    userId: newMessage.author.id,
    channel: channelName ?? '<unknown>',
    channelId: newMessage.channel.id,
    messageId: newMessage.id,
    oldMessage: oldMessage.content,
    newMessage: newMessage.content,
  };
  // Edits cannot add attachments via Discord and the message still exists, so
  // record only their metadata here — the binary archival is a delete concern.
  const updatedAttachmentUrls = newMessage.attachments.map((a) => a.url);
  if (updatedAttachmentUrls.length > 0) {
    details['attachments'] = updatedAttachmentUrls;
  }
  logGuildEvent(logger, newMessage.guildId, 'message_update', details, newMessage.guild.name);
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

  // Hydrate before reading content / attachments. A deleted message's
  // `fetch()` rejects with `Unknown Message`; the helper tolerates that so the
  // unconditional local record below still runs on the cached partial.
  await fetchPartialMessage(message, logger, message.guildId);

  // Rank gates DISCLOSURE only — see handleMessageUpdate. The local record
  // (attachment archival + audit line) runs regardless of this flag.
  const suppressed = policy.isSuppressed(
    message.guildId,
    'guild_events',
    message.channel.id,
    ancestorChannelIdsOf(message.channel, message.guild?.channels.cache),
  );

  const content =
    message.content === null || message.content === undefined || message.content.length === 0
      ? 'No content'
      : truncate(message.content);

  if (!suppressed) {
    const eventChannel = resolveEventChannel(registry, message.guildId);
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
  }

  // Forensic attachment download — unconditional, regardless of rank, runs for
  // every attachment including images the embed separately previews. URLs are
  // signed CDN links that expire, so the binary download is what makes the
  // local record durable. Fire-and-forget; the helper bounds its own
  // concurrency (a bulk delete can carry a hundred attachments) and has its
  // own try/catch per file.
  if (message.attachments.size > 0) {
    void archiveDeletedAttachments(logger, message.guildId as string, message.attachments.values());
  }

  // Local audit record — unconditional, regardless of rank or event-channel
  // presence, so deletions are traceable even for private channels and when
  // the mirror is offline. Stable ids correlate the line independently.
  const channelName = message.guild.channels.cache.get(message.channel.id)?.name;
  const attachmentUrls = message.attachments.map((a) => a.url);
  const details: Record<string, unknown> = {
    user: message.author.username,
    userId: message.author.id,
    channel: channelName ?? '<unknown>',
    channelId: message.channel.id,
    messageId: message.id,
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
