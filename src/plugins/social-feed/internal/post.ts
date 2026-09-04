/**
 * Turn a selected {@link FeedPost} into a Discord message.
 *
 * The message is a plain-text line carrying the platform's embeddable
 * link rather than a bot-authored embed: Discord unfurls an embed-proxy
 * domain into a *playable* video, which an `EmbedBuilder` cannot render.
 * This is the same mechanism `social-link-preview` uses for the same
 * reason, and it keeps the plugin from downloading and re-uploading
 * media. Which URL is embeddable is the platform's knowledge, so this
 * module asks it rather than rewriting hosts itself.
 *
 * Every send uses `allowedMentions: { parse: [] }` so post text can
 * never trigger an @everyone / @role ping.
 */
import type { SendableChannels } from 'discord.js';

import type { Translator } from '../../../core/i18n';
import type { FeedPlatform, FeedPost } from '../../../infra/social-feed';

const NO_MENTIONS = { parse: [] as const };

/** Compose the announcement line for one post. */
export const buildFeedMessage = (
  translator: Translator,
  platform: FeedPlatform,
  post: FeedPost,
): string =>
  translator.t('replies:feed.post', {
    author: post.authorAccount,
    platform: platform.displayName,
    url: platform.toEmbedUrl(post),
  });

/** Post one announcement. The caller has already checked sendability. */
export const sendFeedPost = async (channel: SendableChannels, content: string): Promise<void> => {
  await channel.send({ content, allowedMentions: NO_MENTIONS });
};
