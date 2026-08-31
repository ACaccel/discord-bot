/**
 * Render a {@link LinkPreviewResult} into a Discord reply.
 *
 * This is the one place that branches on the result mechanism:
 *   - `rewritten-url`: reply with the proxy URL as plain content so
 *     Discord unfurls it into a (playable) embed;
 *   - `card`: build a static {@link EmbedBuilder} from the neutral
 *     OpenGraph card and reply with it.
 *
 * Every reply uses `allowedMentions: { parse: [] }` so preview content
 * can never trigger an @everyone / @role ping (matches `llm-chat`).
 */
import { EmbedBuilder, type Message } from 'discord.js';

import type { Translator } from '../../../core/i18n';
import type { LinkPreviewResult, PreviewCard } from '../../../infra/link-preview';

const NO_MENTIONS = { parse: [] as const };
/** Neutral accent for bot-built preview cards. */
const EMBED_COLOR = 0x2b90d9;
const MAX_TITLE = 256;
const MAX_DESCRIPTION = 350;

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 3)}...`;

/** Build a static embed from a neutral preview card. Exported for tests. */
export const buildCardEmbed = (card: PreviewCard, translator: Translator): EmbedBuilder => {
  const embed = new EmbedBuilder().setColor(EMBED_COLOR);
  if (card.title !== undefined && card.title.length > 0) {
    embed.setTitle(truncate(card.title, MAX_TITLE));
    embed.setURL(card.url);
  }
  if (card.description !== undefined && card.description.length > 0) {
    embed.setDescription(truncate(card.description, MAX_DESCRIPTION));
  }
  // Only set an https image: Discord requires it, and it prevents a
  // scraped page from injecting a non-https (or javascript:) image URL.
  if (card.imageUrl !== undefined && card.imageUrl.startsWith('https://')) {
    embed.setImage(card.imageUrl);
  }
  if (card.siteName !== undefined && card.siteName.length > 0) {
    embed.setFooter({
      text: translator.t('replies:social_link_preview.embed_footer', { provider: card.siteName }),
    });
  }
  return embed;
};

export const renderPreview = async (
  message: Message,
  result: LinkPreviewResult,
  translator: Translator,
): Promise<void> => {
  if (result.kind === 'rewritten-url') {
    await message.reply({ content: result.url, allowedMentions: NO_MENTIONS });
    return;
  }
  await message.reply({
    embeds: [buildCardEmbed(result.card, translator)],
    allowedMentions: NO_MENTIONS,
  });
};
