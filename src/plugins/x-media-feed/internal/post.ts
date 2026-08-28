/**
 * Turn a selected {@link XPost} into a Discord message.
 *
 * The message is a plain-text line carrying an embed-proxy link rather
 * than a bot-authored embed: Discord unfurls the proxy domain into a
 * *playable* video, which an `EmbedBuilder` cannot render. This is the
 * same mechanism `social-link-preview` uses for the same reason, and it
 * keeps the plugin from downloading and re-uploading media.
 *
 * Every send uses `allowedMentions: { parse: [] }` so post text can
 * never trigger an @everyone / @role ping.
 */
import type { SendableChannels } from 'discord.js';

import type { Translator } from '../../../core/i18n';
import type { XPost } from '../../../infra/x-feed';

const NO_MENTIONS = { parse: [] as const };

/**
 * Swap the host of a canonical post permalink for the embed proxy.
 *
 * Rewriting the upstream-supplied URL (rather than rebuilding one from
 * parts) keeps the path exactly as the source reported it. Returns the
 * original URL when it cannot be parsed, so a malformed permalink still
 * posts something useful instead of nothing.
 */
export const toEmbedProxyUrl = (rawUrl: string, embedProxyHost: string): string => {
  try {
    const url = new URL(rawUrl);
    // An invalid hostname is silently ignored by the URL setter, which
    // leaves the original host in place — the safe direction.
    url.hostname = embedProxyHost;
    return url.toString();
  } catch {
    return rawUrl;
  }
};

/** Compose the announcement line for one post. */
export const buildFeedMessage = (
  translator: Translator,
  post: XPost,
  embedProxyHost: string,
): string =>
  translator.t('replies:x_media_feed.post', {
    author: post.authorHandle,
    url: toEmbedProxyUrl(post.url, embedProxyHost),
  });

/** Post one announcement. The caller has already checked sendability. */
export const sendFeedPost = async (
  channel: SendableChannels,
  content: string,
): Promise<void> => {
  await channel.send({ content, allowedMentions: NO_MENTIONS });
};
