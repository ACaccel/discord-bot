/**
 * `/feed_unsubscribe` — stop forwarding social posts into a channel.
 *
 * Authority is ungated, reach is not: like the other `/feed_*`
 * commands, this one only operates on a channel the invoker can already
 * see. Without that, any member could quietly empty the feeds of a
 * channel they have no access to.
 *
 * Channel-centric, matching the subscription key: the channel is always
 * part of the scope (defaulting to the invoking one) and `platform` /
 * `account` — which accepts a list — only narrow it. Naming neither
 * clears the channel, which is the operation a member most often wants.
 *
 * Nothing here consults the upstream. Removing a subscription must keep
 * working after a platform has been switched off in config, or a
 * retired platform's entries would be impossible to clear.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { bindTranslator } from '../../../core/i18n';
import { logSystem, ops } from '../../../core/logger';
import { getOptionalString } from '../../../infra/discord/options';
import { replyForError } from '../../../infra/discord/reply-for-error';
import {
  SUPPORTED_FEED_PLATFORMS,
  feedAccountRefusal,
  parseFeedAccounts,
} from '../../../infra/social-feed';
import { requireGuildRepos } from '../../require-guild-repos';
import { formatRemovedForLog, formatRemovedForReply } from './format-removed';
import { resolveUnsubscribeAccounts } from './resolve-account';

const platformChoices = SUPPORTED_FEED_PLATFORMS.map((id) => ({ value: id }));

export default class feed_unsubscribe extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'feed_unsubscribe',
      category: 'utility',
      options: {
        channel: [{ name: 'channel', required: false }],
        string: [
          { name: 'platform', required: false, choices: platformChoices },
          { name: 'account', required: false },
        ],
      },
    });
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Falls back to the key, never to '', which Discord rejects.
    const t = bindTranslator(bot.translator);
    const refuse = async (key: string, params?: Record<string, string | number>): Promise<void> => {
      await interaction.editReply({ content: t(key, params) });
    };
    try {
      const guild = interaction.guild;
      const repos = await requireGuildRepos(bot, interaction);
      // Already replied on null; the `guild` half restates that for tsc.
      if (repos === null || guild === null) return;

      const selected = interaction.options.getChannel('channel');
      const channel = guild.channels.cache.get(selected?.id ?? interaction.channelId);
      if (channel === undefined) return refuse('replies:feed.channel_not_supported');
      const mention = `<#${channel.id}>`;

      // Same visibility rule as `/feed_subscribe`, and the same reason
      // to resolve a `GuildMember` rather than pass an id: the id
      // overload answers null for an uncached member, which would read
      // as a refusal instead of as "unknown".
      const gate = channel.isThread() ? channel.parent : channel;
      const invoker = guild.members.cache.get(interaction.user.id);
      const perms = gate === null || invoker === undefined ? null : gate.permissionsFor(invoker);
      if (perms === null) return refuse('replies:feed.permissions_unknown', { channel: mention });
      if (!perms.has(PermissionFlagsBits.ViewChannel)) {
        return refuse('replies:feed.invoker_cannot_view', { channel: mention });
      }

      // The option names as many accounts as the member cares to list;
      // an unusable list is refused before anything is deleted.
      const raw = getOptionalString(interaction, 'account');
      const parsed = raw === undefined ? undefined : parseFeedAccounts(raw);
      if (parsed !== undefined && parsed.kind !== 'accounts') {
        return refuse(...feedAccountRefusal(parsed));
      }

      const platform = getOptionalString(interaction, 'platform');
      const accounts = resolveUnsubscribeAccounts(
        platform === undefined ? undefined : bot.feedPlatformRegistry?.get(platform),
        parsed?.accounts,
      );
      // An invalid handle is reported as such rather than as an empty
      // deletion; `replyForError` renders its `errors:feed.*` copy.
      if (!accounts.ok) throw accounts.error;

      const deleted = await repos.feedSubscription.deleteWhere({
        channelId: channel.id,
        platform,
        accounts: accounts.value,
      });
      if (!deleted.ok) throw deleted.error;
      const removed = deleted.value;

      if (removed.length === 0) {
        // Without a platform or an account the scope was the whole
        // channel, so "nothing here" is the complete answer. With one,
        // the narrowing is the likelier reason nothing matched.
        const key =
          platform === undefined && accounts.value === undefined
            ? 'replies:feed.unsubscribed_none'
            : 'replies:feed.unsubscribed_none_hint';
        return refuse(key, { channel: mention });
      }

      // Logged before the reply: the deletion has already committed, and
      // the confirmation is both bounded and losable.
      logSystem(
        bot.logger,
        ops.feed.subscriptionsRemoved(channel.id, removed.length, formatRemovedForLog(removed)),
      );
      await interaction.editReply({
        content: t('replies:feed.unsubscribed', {
          count: removed.length,
          list: formatRemovedForReply(removed, t),
        }),
      });
    } catch (err) {
      await replyForError(interaction, bot, err, 'replies:feed.failed', interaction.guildId);
    }
  }
}
