/**
 * LlmChatPlugin — moves Konata's chat lifecycle onto the plugin host.
 *
 * Listens for `messageCreate` events. Behaviour preserved verbatim
 * from `src/bot/konata/konata.ts`:
 *   - whitelisted users only (via `UserApiSettingRepo`);
 *   - @-mention starts a new session;
 *   - a reply to an active session message continues it (owner-only);
 *   - placeholder reply edited with the LLM response;
 *   - 2000-char-safe paragraph-aware chunking;
 *   - usage-footer appended;
 *   - sessions tracked by `SessionManager`;
 *   - all bot output sanitised with `allowedMentions: { parse: [] }`
 *     so prompt-induced @everyone/@role/@user pings cannot fire.
 *
 * Bot identity is injected via `clientId` — the plugin uses it to
 * strip its own mention from input and to drive the new-vs-continue
 * branching, and to tag legacy error logs.
 */
import type { Message } from 'discord.js';

import { TOKENS } from '../../core/ioc';
import type { Plugin } from '../../core/plugin';
import {
  LLMService,
  MissingApiKeyError,
  SessionManager,
  createDefaultRegistry,
  formatUsageFooter,
  listProviderModels,
  type LLMMessage,
  type LLMProviderName,
  type LLMResult,
  type LLMSettings,
} from '../../features/llm_chat';
import * as legacyLogger from '../../utils/logger';

const PLUGIN_ID = 'llm-chat';
const PLUGIN_VERSION = '1.0.0';
const PREWARM_PROVIDERS: LLMProviderName[] = ['xai', 'openai', 'anthropic', 'gemini'];
const PLACEHOLDER_REPLY = '🤔 思考中…';
const NO_MENTIONS = { parse: [] as const };
const MAX_DISCORD_MESSAGE_LENGTH = 2000;

export interface LlmChatPluginConfig {
  readonly clientId: string;
}

interface UserApiDoc {
  userId: string;
  provider: string;
  model: string;
  temperature: number;
  system_prompt: string;
  web_search: boolean;
}

const toSettings = (doc: UserApiDoc): LLMSettings => ({
  provider: doc.provider as LLMProviderName,
  model: doc.model,
  temperature: doc.temperature,
  systemPrompt: doc.system_prompt,
  webSearch: doc.web_search,
});

const stripMention = (content: string, clientId: string): string =>
  content.replace(new RegExp(`<@!?${clientId}>`, 'g'), '').trim();

const appendUsageFooter = (result: LLMResult, model: string): string => {
  const footer = formatUsageFooter(model, result.usage);
  return footer.length > 0 ? `${result.content}\n${footer}` : result.content;
};

const deliverChunked = async (
  message: Message,
  placeholder: Message,
  text: string,
): Promise<Message[]> => {
  if (text.length <= MAX_DISCORD_MESSAGE_LENGTH) {
    const edited = await placeholder.edit({ content: text, allowedMentions: NO_MENTIONS });
    return [edited];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_DISCORD_MESSAGE_LENGTH) {
    let splitAt = remaining.lastIndexOf('\n\n', MAX_DISCORD_MESSAGE_LENGTH);
    if (splitAt < MAX_DISCORD_MESSAGE_LENGTH * 0.5) {
      splitAt = remaining.lastIndexOf('\n', MAX_DISCORD_MESSAGE_LENGTH);
    }
    if (splitAt < MAX_DISCORD_MESSAGE_LENGTH * 0.5) {
      splitAt = remaining.lastIndexOf(' ', MAX_DISCORD_MESSAGE_LENGTH);
    }
    if (splitAt <= 0) splitAt = MAX_DISCORD_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);

  const sent: Message[] = [];
  sent.push(
    await placeholder.edit({ content: chunks[0]!, allowedMentions: NO_MENTIONS }),
  );
  for (let i = 1; i < chunks.length; i += 1) {
    if (message.channel.isSendable()) {
      sent.push(
        (await message.channel.send({ content: chunks[i]!, allowedMentions: NO_MENTIONS })) as Message,
      );
    }
  }
  return sent;
};

const handleChatError = async (
  err: unknown,
  clientId: string,
  guildId: string | null,
  placeholder: Message,
): Promise<void> => {
  legacyLogger.errorLogger(clientId, guildId, err);
  const content =
    err instanceof MissingApiKeyError
      ? `Provider \`${err.provider}\` 的 API 金鑰未設定（請於 .env 設定 \`${err.envVar}\`）。`
      : '呼叫 AI API 時發生錯誤，請稍後再試。';
  try {
    await placeholder.edit({ content, allowedMentions: NO_MENTIONS });
  } catch {
    if (placeholder.channel.isSendable()) {
      await placeholder.channel.send({ content, allowedMentions: NO_MENTIONS });
    }
  }
};

export const createLlmChatPlugin = (config: LlmChatPluginConfig): Plugin => {
  const sessions = new SessionManager();
  const llmService = new LLMService(createDefaultRegistry());

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    critical: false,

    async init(): Promise<void> {
      // Pre-warm each provider's live model catalog at boot. The call
      // returns a fallback sync while kicking off the SDK fetch, so by
      // the time `/ai_settings` is invoked the cache is usually warm.
      for (const provider of PREWARM_PROVIDERS) {
        listProviderModels(provider);
      }
    },

    events: {
      messageCreate: async (ctx, message) => {
        if (message.author.bot || message.guildId === null) return;
        const registry = ctx.resolve(TOKENS.GuildRegistry);
        const repos = registry.getRepos(message.guildId);
        if (repos === undefined) return;

        const userDoc = (await repos.userApiSetting.findByUserId(message.author.id)) as
          | UserApiDoc
          | null
          | undefined;
        if (userDoc === undefined || userDoc === null) return; // not whitelisted

        // Case 1: @-mention -> new session. `ignoreRepliedUser` is
        // critical so a reply to the bot does not get classed as a
        // fresh @-tag.
        if (message.mentions.has(config.clientId, { ignoreRepliedUser: true })) {
          await handleNewSession(message, userDoc, sessions, llmService, config.clientId);
          return;
        }

        // Case 2: reply to a bot message belonging to an active
        // session continues that session.
        const refId = message.reference?.messageId;
        if (refId !== undefined && sessions.hasActiveSession(refId)) {
          await handleContinueSession(
            message,
            refId,
            userDoc,
            sessions,
            llmService,
            config.clientId,
          );
        }
      },
    },
  };
};

const sendPlaceholder = async (message: Message): Promise<Message> =>
  (await message.reply({ content: PLACEHOLDER_REPLY, allowedMentions: NO_MENTIONS })) as Message;

const handleNewSession = async (
  message: Message,
  userConfig: UserApiDoc,
  sessions: SessionManager,
  llmService: LLMService,
  clientId: string,
): Promise<void> => {
  const userText = stripMention(message.content, clientId);
  if (userText.length === 0) return;

  const settings = toSettings(userConfig);
  const userMsg: LLMMessage = { role: 'user', content: userText };
  const placeholder = await sendPlaceholder(message);

  let result: LLMResult;
  try {
    result = await llmService.chat([userMsg], settings);
  } catch (err) {
    await handleChatError(err, clientId, message.guildId, placeholder);
    return;
  }

  // Create the session before the user can send a follow-up so
  // back-to-back messages do not race the session table.
  sessions.startSession(message.author.id, message.guildId as string, message.channelId);

  const finalText = appendUsageFooter(result, settings.model);
  const botMsgs = await deliverChunked(message, placeholder, finalText);
  const assistantMsg: LLMMessage = { role: 'assistant', content: result.content };
  sessions.appendToHistory(
    message.author.id,
    message.channelId,
    userMsg,
    assistantMsg,
    botMsgs.map((m) => m.id),
  );
};

const handleContinueSession = async (
  message: Message,
  refBotMessageId: string,
  userConfig: UserApiDoc,
  sessions: SessionManager,
  llmService: LLMService,
  clientId: string,
): Promise<void> => {
  const session = sessions.resolveSessionByBotMessage(refBotMessageId);
  if (session === null || session === undefined) return;
  // Only the session owner can continue — prevents hijacking by a
  // bystander replying to the bot.
  if (session.userId !== message.author.id) return;

  const userText = message.content.trim();
  if (userText.length === 0) return;

  const settings = toSettings(userConfig);
  const userMsg: LLMMessage = { role: 'user', content: userText };
  const history = [...session.history, userMsg];
  const placeholder = await sendPlaceholder(message);

  let result: LLMResult;
  try {
    result = await llmService.chat(history, settings);
  } catch (err) {
    await handleChatError(err, clientId, message.guildId, placeholder);
    return;
  }

  const finalText = appendUsageFooter(result, settings.model);
  const botMsgs = await deliverChunked(message, placeholder, finalText);
  const assistantMsg: LLMMessage = { role: 'assistant', content: result.content };
  sessions.appendToHistory(
    session.userId,
    session.channelId,
    userMsg,
    assistantMsg,
    botMsgs.map((m) => m.id),
  );
};
