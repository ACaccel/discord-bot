import type { LLMMessage } from '../../../infra/llm';

interface Session {
    userId: string;
    guildId: string;
    channelId: string;
    history: LLMMessage[];
    /** All bot message IDs that belong to this session, tracked for cleanup on replacement. */
    botMessageIds: Set<string>;
}

/**
 * In-memory store for active LLM chat sessions.
 *
 * Session lifecycle:
 *   - A session is keyed by `${userId}_${channelId}`.
 *   - Every bot reply message ID is indexed so that a user replying to any
 *     bot message in the conversation can continue the same session.
 *   - Tagging the bot again replaces the existing session for that user+channel.
 */
export class SessionManager {
    /** session key → Session */
    private readonly sessions = new Map<string, Session>();

    /** bot message ID → session key */
    private readonly botMessageIndex = new Map<string, string>();

    private buildKey(userId: string, channelId: string): string {
        return `${userId}_${channelId}`;
    }

    public startSession(
        userId: string,
        guildId: string,
        channelId: string,
    ): void {
        const key = this.buildKey(userId, channelId);

        // Evict stale bot-message anchors from the previous session at this key
        // so that old replies cannot accidentally continue the new session.
        const existing = this.sessions.get(key);
        if (existing) {
            existing.botMessageIds.forEach((msgId) => this.botMessageIndex.delete(msgId));
        }

        this.sessions.set(key, { userId, guildId, channelId, history: [], botMessageIds: new Set() });
    }

    /** Returns the session associated with a bot message ID, or undefined. */
    public resolveSessionByBotMessage(botMessageId: string): Session | undefined {
        const key = this.botMessageIndex.get(botMessageId);
        if (!key) return undefined;
        return this.sessions.get(key);
    }

    public hasActiveSession(botMessageId: string): boolean {
        const key = this.botMessageIndex.get(botMessageId);
        if (!key) return false;
        return this.sessions.has(key);
    }

    /**
     * Append a completed exchange to the session history and register all bot
     * message IDs (one per chunk) so a reply to any chunk continues the session.
     */
    public appendToHistory(
        userId: string,
        channelId: string,
        userMessage: LLMMessage,
        assistantMessage: LLMMessage,
        botMessageIds: string[],
    ): void {
        const key = this.buildKey(userId, channelId);
        const session = this.sessions.get(key);
        if (!session) return;
        session.history.push(userMessage, assistantMessage);
        for (const msgId of botMessageIds) {
            session.botMessageIds.add(msgId);
            this.botMessageIndex.set(msgId, key);
        }
    }

    public getHistory(userId: string, channelId: string): LLMMessage[] {
        return this.sessions.get(this.buildKey(userId, channelId))?.history ?? [];
    }
}
