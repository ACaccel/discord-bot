/**
 * TtsReplyPlugin — when a user posts the literal text `"tts"` as a
 * reply, fetch the referenced message and produce a TTS audio file.
 *
 * Behaviour preserved verbatim from `src/events/message_reply.ts`
 * `tts_reply`. The underlying `misc.tts_api` translation + voice
 * synthesis call stays untouched; the plugin is a thin event adapter.
 *
 * The plugin holds no per-bot config today. Adding a future toggle
 * (per-guild whitelist, voice profile selection) will require switching
 * the export to a `createTtsReplyPlugin(config)` factory.
 */
import type { TextChannel } from 'discord.js';

import type { Plugin } from '../../core/plugin';
import { ttsApi } from './tts-api';

const PLUGIN_ID = 'tts-reply';
const PLUGIN_VERSION = '1.0.0';

const TRIGGER = 'tts';

export const TtsReplyPlugin: Plugin = {
  id: PLUGIN_ID,
  version: PLUGIN_VERSION,
  scope: 'bot',
  critical: false,

  events: {
    messageCreate: async (_ctx, message): Promise<void> => {
      if (message.content !== TRIGGER) return;
      // The legacy code reached into the parent channel via the reply
      // reference. Preserve the exact path: lookup channel by id, then
      // message by id within that channel's cache.
      const referenceChannelId = message.reference?.channelId;
      const referenceMessageId = message.reference?.messageId;
      if (referenceChannelId === undefined || referenceMessageId === undefined) {
        await message.reply('Cannot find the message');
        return;
      }
      const refChannel = message.guild?.channels.cache.get(referenceChannelId) as
        | TextChannel
        | undefined;
      const refContent = refChannel?.messages.cache.get(referenceMessageId)?.content;
      if (refContent === undefined || refContent.length === 0) {
        await message.reply('Cannot find the message');
        return;
      }

      const { attachment, error } = await ttsApi(refContent);
      if (error.length > 0) {
        await message.reply(error);
        return;
      }
      if (attachment === null) return;
      await message.reply({ files: [attachment] });
    },
  },
};
