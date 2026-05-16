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

import type { LlmProviderError } from '../../core/errors';
import type { Translator } from '../../core/i18n';
import { TOKENS } from '../../core/ioc';
import type { Plugin } from '../../core/plugin';
import {
  LLMService,
  createDefaultRegistry,
  formatUsageFooter,
  listProviderModels,
  setProviderApiKeys,
  type LLMMessage,
  type LLMProviderName,
  type LLMResult,
  type LLMSettings,
} from '../../infra/llm';
import { SessionManager } from './internal';
import * as legacyLogger from '../../utils/logger';

const PLUGIN_ID = 'llm-chat';
const PLUGIN_VERSION = '1.0.0';
const PREWARM_PROVIDERS: LLMProviderName[] = ['xai', 'openai', 'anthropic', 'gemini'];
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

/**
 * Render an LLM failure into a Discord reply. The error has already been
 * translated into a typed {@link LlmProviderError} by `LLMService.chat`,
 * so this handler does not need to discriminate on instance kinds — it
 * reads `messageKey` + `messageParams` directly. The legacy log line
 * keeps the err object intact so pino's serialiser captures the cause
 * chain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLlmProviderError = LlmProviderError<any>;

const handleChatError = async (
  llmErr: AnyLlmProviderError,
  clientId: string,
  guildId: string | null,
  placeholder: Message,
  translator: Translator,
): Promise<void> => {
  legacyLogger.errorLogger(clientId, guildId, llmErr);
  const content = translator.t(
    llmErr.messageKey,
    llmErr.messageParams as Record<string, string | number> | undefined,
  );
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
  // `llmService` is populated in `init()` from the resolved typed Env
  // rather than at factory time, so the registry's API-key gate sees
  // the values supplied through DI rather than direct `process.env`
  // reads. The events handler below guards on `llmService` so a
  // pre-init dispatch (impossible in production — host enforces
  // ordering — but possible in tests) silently no-ops.
  let llmService: LLMService | undefined;

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    critical: false,

    async init(ctx): Promise<void> {
      const env = ctx.resolve(TOKENS.Env);
      llmService = new LLMService(createDefaultRegistry(env));
      // Audit C-4 follow-up: feed the same API-key map into the model
      // catalog so its background fetch reads from the typed Env
      // instead of `process.env` directly (the latter would violate
      // `no-restricted-syntax` now that this module lives in infra/).
      setProviderApiKeys({
        xai: env.XAI_API_KEY,
        openai: env.OPENAI_API_KEY,
        anthropic: env.ANTHROPIC_API_KEY,
        gemini: env.GEMINI_API_KEY,
      });
      // Pre-warm each provider's live model catalog at boot. The call
      // returns a fallback sync while kicking off the SDK fetch, so by
      // the time `/ai_settings` is invoked the cache is usually warm.
      for (const provider of PREWARM_PROVIDERS) {
        listProviderModels(provider);
      }
    },

    events: {
      messageCreate: async (ctx, message) => {
        if (llmService === undefined) return;
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
          await handleNewSession(
            message,
            userDoc,
            sessions,
            llmService,
            config.clientId,
            ctx.translator,
          );
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
            ctx.translator,
          );
        }
      },
    },
  };
};

const sendPlaceholder = async (message: Message, translator: Translator): Promise<Message> =>
  (await message.reply({
    content: translator.t('replies:llm_chat.thinking'),
    allowedMentions: NO_MENTIONS,
  })) as Message;

const handleNewSession = async (
  message: Message,
  userConfig: UserApiDoc,
  sessions: SessionManager,
  llmService: LLMService,
  clientId: string,
  translator: Translator,
): Promise<void> => {
  const userText = stripMention(message.content, clientId);
  if (userText.length === 0) return;

  const settings = toSettings(userConfig);
  const userMsg: LLMMessage = { role: 'user', content: userText };
  const placeholder = await sendPlaceholder(message, translator);

  const chatResult = await llmService.chat([userMsg], settings);
  if (!chatResult.ok) {
    await handleChatError(chatResult.error, clientId, message.guildId, placeholder, translator);
    return;
  }
  const result: LLMResult = chatResult.value;

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
  translator: Translator,
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
  const placeholder = await sendPlaceholder(message, translator);

  const chatResult = await llmService.chat(history, settings);
  if (!chatResult.ok) {
    await handleChatError(chatResult.error, clientId, message.guildId, placeholder, translator);
    return;
  }
  const result: LLMResult = chatResult.value;

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
