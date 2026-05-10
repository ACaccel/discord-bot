import { ActivityType, Client, Events, Message } from 'discord.js';
import { BaseBot, Config } from '@bot';
import { logger } from '@utils';
import { llmChat } from '@features';
import { LLMSettings, LLMProviderName } from '@llm_chat';

interface UserApiDoc {
    userId: string;
    provider: string;
    model: string;
    temperature: number;
    system_prompt: string;
    web_search: boolean;
}

export class Konata extends BaseBot<Config> {
    private readonly sessionManager: llmChat.SessionManager;
    private readonly llmService: llmChat.LLMService;

    public constructor(
        client: Client,
        token: string,
        mongoURI: string,
        clientId: string,
        config: Config,
    ) {
        super(client, token, mongoURI, clientId, config);
        this.sessionManager = new llmChat.SessionManager();
        this.llmService = new llmChat.LLMService();
        this.prewarmModelCatalog();
        this.registerPresence();
    }

    /**
     * Without an explicit presence, Discord clients tend to render an idle bot
     * as offline even though its gateway session is still alive. Register a
     * ready-time presence so konata reliably appears online with a custom
     * status line.
     */
    private registerPresence(): void {
        this.client.once(Events.ClientReady, () => {
            const text = '貧乳はステータスだ、希少価値だ！';
            this.client.user?.setPresence({
                status: 'online',
                activities: [{
                    name: text,
                    type: ActivityType.Custom,
                    state: text,
                }],
            });
        });
    }

    /**
     * Trigger a background fetch of every provider's live model list at boot.
     * `listProviderModels` returns a fallback synchronously while kicking off
     * the SDK call, so by the time a user invokes `/ai_settings` the cache is
     * usually warm and the modal shows the up-to-date live list rather than
     * the hardcoded fallback.
     */
    private prewarmModelCatalog(): void {
        const providers: LLMProviderName[] = ['xai', 'openai', 'anthropic', 'gemini'];
        for (const p of providers) {
            llmChat.listProviderModels(p);
        }
    }

    // ─── Event Listeners ──────────────────────────────────────────────────────

    // ─── Suppress all non-chat events ──────────────────────────────────────────
    // Konata is a pure LLM-chat bot; it must not log message edits/deletes,
    // reactions, member updates, or guild joins. Override BaseBot's detect*
    // hooks with no-ops so those events are silently ignored.
    public override messageUpdateListener = async (): Promise<void> => {};
    public override messageDeleteListener = async (): Promise<void> => {};
    public override messageReactionAddListener = async (): Promise<void> => {};
    public override messageReactionRemoveListener = async (): Promise<void> => {};
    public override guildMemberUpdateListener = async (): Promise<void> => {};
    public override guildCreateListener = async (): Promise<void> => {};

    public override messageCreateListener = async (message: Message): Promise<void> => {
        if (message.author.bot || !message.guildId) return;

        const userId = message.author.id;
        const guildId = message.guildId;

        const userConfig = await this.fetchUserApiSetting(guildId, userId);
        if (!userConfig) return;   // not whitelisted

        // Case 1: user tags the bot → start a new session.
        // ignoreRepliedUser: a Discord reply auto-includes the replied-to user in
        // mentions; without this flag every reply to the bot would be treated as
        // an explicit @-tag and reset the session instead of continuing it.
        if (message.mentions.has(this.clientId, { ignoreRepliedUser: true })) {
            await this.handleNewSession(message, userConfig);
            return;
        }

        // Case 2: user replies to a bot message that belongs to an active session
        const refId = message.reference?.messageId;
        if (refId && this.sessionManager.hasActiveSession(refId)) {
            await this.handleContinueSession(message, refId, userConfig);
        }
    }

    // ─── Session Handlers ─────────────────────────────────────────────────────

    private async handleNewSession(message: Message, userConfig: UserApiDoc): Promise<void> {
        const userText = this.stripMentions(message.content);
        if (!userText.trim()) return;

        const settings = this.toSettings(userConfig);
        const userMsg: llmChat.LLMMessage = { role: 'user', content: userText };

        // Send a placeholder right away so the user knows the request is being
        // processed, then edit it with the real response once the LLM returns.
        const placeholder = await this.sendPlaceholder(message);

        let result: llmChat.LLMResult;
        try {
            result = await this.llmService.chat([userMsg], settings);
        } catch (err) {
            await this.handleChatError(err, message.guildId, placeholder);
            return;
        }

        // Create the session before sending to avoid any race with subsequent messages.
        this.sessionManager.startSession(
            message.author.id,
            message.guildId as string,
            message.channelId,
        );

        const finalText = this.appendUsageFooter(result, settings.model);
        const botMsgs = await this.deliverChunked(message, placeholder, finalText);

        const assistantMsg: llmChat.LLMMessage = { role: 'assistant', content: result.content };
        this.sessionManager.appendToHistory(
            message.author.id,
            message.channelId,
            userMsg,
            assistantMsg,
            botMsgs.map((m) => m.id),
        );
    }

    private async handleContinueSession(
        message: Message,
        refBotMessageId: string,
        userConfig: UserApiDoc,
    ): Promise<void> {
        const session = this.sessionManager.resolveSessionByBotMessage(refBotMessageId);
        if (!session) return;

        // Only the session owner can continue it; prevent other users from hijacking.
        if (session.userId !== message.author.id) return;

        const userText = message.content.trim();
        if (!userText) return;

        const settings = this.toSettings(userConfig);
        const userMsg: llmChat.LLMMessage = { role: 'user', content: userText };
        const history = [...session.history, userMsg];

        const placeholder = await this.sendPlaceholder(message);

        let result: llmChat.LLMResult;
        try {
            result = await this.llmService.chat(history, settings);
        } catch (err) {
            await this.handleChatError(err, message.guildId, placeholder);
            return;
        }

        const finalText = this.appendUsageFooter(result, settings.model);
        const botMsgs = await this.deliverChunked(message, placeholder, finalText);
        const assistantMsg: llmChat.LLMMessage = { role: 'assistant', content: result.content };
        this.sessionManager.appendToHistory(
            session.userId,
            session.channelId,
            userMsg,
            assistantMsg,
            botMsgs.map((m) => m.id),
        );
    }

    /** Send the initial "thinking" reply that will later be edited. */
    private async sendPlaceholder(message: Message): Promise<Message> {
        return (await message.reply({
            content: '🤔 思考中…',
            allowedMentions: { parse: [] },
        })) as Message;
    }

    /**
     * Convert a chat exception into a user-facing reply, preferring to edit
     * the existing placeholder so the user does not see a stale "thinking…"
     * message alongside the error.
     */
    private async handleChatError(
        err: unknown,
        guildId: string | null,
        placeholder: Message,
    ): Promise<void> {
        logger.errorLogger(this.clientId, guildId, err);
        const content = err instanceof llmChat.MissingApiKeyError
            ? `Provider \`${err.provider}\` 的 API 金鑰未設定（請於 .env 設定 \`${err.envVar}\`）。`
            : '呼叫 AI API 時發生錯誤，請稍後再試。';
        try {
            await placeholder.edit({ content, allowedMentions: { parse: [] } });
        } catch {
            // Fallback if the placeholder is no longer editable for any reason.
            if (placeholder.channel.isSendable()) {
                await placeholder.channel.send({ content, allowedMentions: { parse: [] } });
            }
        }
    }

    private appendUsageFooter(result: llmChat.LLMResult, model: string): string {
        const footer = llmChat.formatUsageFooter(model, result.usage);
        return footer ? `${result.content}\n${footer}` : result.content;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Send text, splitting at paragraph/word boundaries to respect Discord's
     * 2000-character limit. Edits the existing placeholder for the first
     * chunk and channel-sends the rest. Returns every produced Message so
     * each ID can be registered as a session reply anchor.
     */
    private async deliverChunked(
        message: Message,
        placeholder: Message,
        text: string,
    ): Promise<Message[]> {
        const MAX = 2000;
        // AI-generated content is untrusted: disable mention parsing to prevent
        // a prompt-induced @everyone / role / user ping from firing.
        const NO_MENTIONS = { parse: [] as [] };

        if (text.length <= MAX) {
            const edited = await placeholder.edit({ content: text, allowedMentions: NO_MENTIONS });
            return [edited];
        }

        const chunks: string[] = [];
        let remaining = text;
        while (remaining.length > MAX) {
            let splitAt = remaining.lastIndexOf('\n\n', MAX);
            if (splitAt < MAX * 0.5) splitAt = remaining.lastIndexOf('\n', MAX);
            if (splitAt < MAX * 0.5) splitAt = remaining.lastIndexOf(' ', MAX);
            if (splitAt <= 0) splitAt = MAX;
            chunks.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt).trimStart();
        }
        if (remaining) chunks.push(remaining);

        const sentMessages: Message[] = [];
        sentMessages.push(
            await placeholder.edit({ content: chunks[0]!, allowedMentions: NO_MENTIONS }),
        );
        for (let i = 1; i < chunks.length; i++) {
            if (message.channel.isSendable()) {
                sentMessages.push(
                    (await message.channel.send({
                        content: chunks[i]!,
                        allowedMentions: NO_MENTIONS,
                    })) as Message,
                );
            }
        }
        return sentMessages;
    }

    /** Returns the user's ApiSetting doc if they are whitelisted, null otherwise. */
    private async fetchUserApiSetting(guildId: string, userId: string): Promise<UserApiDoc | null> {
        const model = this.guildInfo[guildId]?.db?.models['UserApiSetting'];
        if (!model) return null;
        return model.findOne({ userId }).lean() as Promise<UserApiDoc | null>;
    }

    /** Remove only this bot's mention tag from the message content, preserving other user mentions. */
    private stripMentions(content: string): string {
        return content
            .replace(new RegExp(`<@!?${this.clientId}>`, 'g'), '')
            .trim();
    }

    /** Convert a DB document to the LLMSettings shape required by LLMService. */
    private toSettings(doc: UserApiDoc): LLMSettings {
        return {
            provider: doc.provider as LLMProviderName,
            model: doc.model,
            temperature: doc.temperature,
            systemPrompt: doc.system_prompt,
            webSearch: doc.web_search,
        };
    }
}
