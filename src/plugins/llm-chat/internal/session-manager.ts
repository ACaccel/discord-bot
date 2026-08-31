import type { Clock } from '../../../core/time';
import { systemClock } from '../../../core/time';
import type { LLMMessage } from '../../../infra/llm';

interface Session {
  userId: string;
  guildId: string;
  channelId: string;
  history: LLMMessage[];
  /** All bot message IDs that belong to this session, tracked for cleanup on replacement. */
  botMessageIds: Set<string>;
  /** Timestamp of the last read or write, used for idle eviction. */
  lastActivityAt: number;
}

/**
 * Maximum number of messages kept per session — user and assistant
 * turns combined, so this is {@link MAX_HISTORY_MESSAGES} / 2 exchanges.
 * The whole history is re-sent to the provider on every follow-up, so an
 * unbounded conversation grows the request (and its cost) without limit;
 * the oldest exchange is dropped once the cap is reached.
 */
const MAX_HISTORY_MESSAGES = 20;

/**
 * How long a session survives without activity. Sessions are only ever
 * replaced (by a fresh mention in the same channel), never explicitly
 * ended, so without an expiry the map and its bot-message index grow for
 * the lifetime of the process.
 */
const SESSION_IDLE_TTL_MS = 60 * 60 * 1000;

/**
 * In-memory store for active LLM chat sessions.
 *
 * Session lifecycle:
 *   - A session is keyed by `${userId}_${channelId}`.
 *   - Every bot reply message ID is indexed so that a user replying to any
 *     bot message in the conversation can continue the same session.
 *   - Tagging the bot again replaces the existing session for that user+channel.
 *   - A session idle for {@link SESSION_IDLE_TTL_MS} is evicted along
 *     with its bot-message anchors on the next operation.
 */
export class SessionManager {
  /** session key → Session */
  private readonly sessions = new Map<string, Session>();

  /** bot message ID → session key */
  private readonly botMessageIndex = new Map<string, string>();

  /**
   * @param clock Injected so the idle-eviction behaviour is testable
   *   without wall-clock waits.
   */
  public constructor(private readonly clock: Clock = systemClock) {}

  private buildKey(userId: string, channelId: string): string {
    return `${userId}_${channelId}`;
  }

  /** Drop the session at `key` along with every anchor pointing at it. */
  private evict(key: string): void {
    const session = this.sessions.get(key);
    if (session === undefined) return;
    session.botMessageIds.forEach((msgId) => this.botMessageIndex.delete(msgId));
    this.sessions.delete(key);
  }

  /**
   * Evict every session idle past the TTL. Called at the head of each
   * public operation: sweeping on access keeps the manager free of a
   * timer it would then have to own and unref.
   */
  private sweepExpired(): void {
    const cutoff = this.clock.now() - SESSION_IDLE_TTL_MS;
    for (const [key, session] of this.sessions) {
      if (session.lastActivityAt <= cutoff) this.evict(key);
    }
  }

  /** Look the session up, refreshing its idle deadline on a hit. */
  private touch(key: string): Session | undefined {
    const session = this.sessions.get(key);
    if (session === undefined) return undefined;
    session.lastActivityAt = this.clock.now();
    return session;
  }

  public startSession(userId: string, guildId: string, channelId: string): void {
    this.sweepExpired();
    const key = this.buildKey(userId, channelId);

    // Evict stale bot-message anchors from the previous session at this key
    // so that old replies cannot accidentally continue the new session.
    this.evict(key);

    this.sessions.set(key, {
      userId,
      guildId,
      channelId,
      history: [],
      botMessageIds: new Set(),
      lastActivityAt: this.clock.now(),
    });
  }

  /** Returns the session associated with a bot message ID, or undefined. */
  public resolveSessionByBotMessage(botMessageId: string): Session | undefined {
    this.sweepExpired();
    const key = this.botMessageIndex.get(botMessageId);
    if (!key) return undefined;
    return this.touch(key);
  }

  public hasActiveSession(botMessageId: string): boolean {
    this.sweepExpired();
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
    this.sweepExpired();
    const key = this.buildKey(userId, channelId);
    const session = this.touch(key);
    if (!session) return;
    session.history.push(userMessage, assistantMessage);
    // Drop whole exchanges from the front so the history never starts
    // mid-turn, which some providers reject.
    if (session.history.length > MAX_HISTORY_MESSAGES) {
      session.history.splice(0, session.history.length - MAX_HISTORY_MESSAGES);
    }
    for (const msgId of botMessageIds) {
      session.botMessageIds.add(msgId);
      this.botMessageIndex.set(msgId, key);
    }
  }

  public getHistory(userId: string, channelId: string): LLMMessage[] {
    this.sweepExpired();
    return this.touch(this.buildKey(userId, channelId))?.history ?? [];
  }

  /** Number of live sessions. Exposed for tests and health reporting. */
  public size(): number {
    this.sweepExpired();
    return this.sessions.size;
  }
}
