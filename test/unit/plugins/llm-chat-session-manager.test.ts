/**
 * `SessionManager` growth bounds.
 *
 * Sessions are only ever replaced, never explicitly ended, and every
 * follow-up re-sends the whole history to the provider. Without a
 * history cap and an idle TTL both the request size and the in-memory
 * maps grow for the lifetime of the process.
 */
import { describe, expect, it } from 'vitest';

import { createFakeClock } from '../../../src/core/time';
import { SessionManager } from '../../../src/plugins/llm-chat/internal';
import type { LLMMessage } from '../../../src/infra/llm';

const USER = 'u1';
const GUILD = 'g1';
const CHANNEL = 'c1';

const user = (n: number): LLMMessage => ({ role: 'user', content: `q${n}` });
const assistant = (n: number): LLMMessage => ({ role: 'assistant', content: `a${n}` });

/** Push `count` complete exchanges into the session. */
const exchange = (sessions: SessionManager, n: number): void => {
  sessions.appendToHistory(USER, CHANNEL, user(n), assistant(n), [`bot-${n}`]);
};

describe('SessionManager history cap', () => {
  it('keeps the most recent exchanges and drops the oldest', () => {
    const sessions = new SessionManager(createFakeClock(0));
    sessions.startSession(USER, GUILD, CHANNEL);

    for (let n = 0; n < 30; n += 1) exchange(sessions, n);

    const history = sessions.getHistory(USER, CHANNEL);
    expect(history).toHaveLength(20);
    // The window starts on a user turn — a history beginning mid-turn is
    // rejected by some providers.
    expect(history[0]?.role).toBe('user');
    expect(history.at(-1)).toEqual(assistant(29));
    expect(history).not.toContainEqual(user(0));
  });
});

describe('SessionManager idle eviction', () => {
  it('drops a session that has been idle past the TTL', () => {
    const clock = createFakeClock(0);
    const sessions = new SessionManager(clock);
    sessions.startSession(USER, GUILD, CHANNEL);
    exchange(sessions, 1);
    expect(sessions.size()).toBe(1);

    clock.advance(61 * 60 * 1000);

    expect(sessions.size()).toBe(0);
    expect(sessions.getHistory(USER, CHANNEL)).toEqual([]);
    // The bot-message anchors go with it, otherwise the index outlives
    // every session it points at.
    expect(sessions.hasActiveSession('bot-1')).toBe(false);
    expect(sessions.resolveSessionByBotMessage('bot-1')).toBeUndefined();
  });

  it('keeps a session alive while it is being used', () => {
    const clock = createFakeClock(0);
    const sessions = new SessionManager(clock);
    sessions.startSession(USER, GUILD, CHANNEL);

    for (let n = 0; n < 4; n += 1) {
      clock.advance(50 * 60 * 1000);
      exchange(sessions, n);
    }

    expect(sessions.size()).toBe(1);
    expect(sessions.resolveSessionByBotMessage('bot-3')).toBeDefined();
  });
});
