/**
 * Minimal Message builder for handler / plugin tests. Returns the
 * structural minimum touched by the SUT — id, content, author, guild,
 * channel — plus the `react` / `reply` / `edit` async methods that
 * record their calls via the optional `mockSink`.
 */
import type { Message } from 'discord.js';

export interface MessageMockSink {
  readonly reactions: string[];
  readonly replies: string[];
  readonly edits: string[];
}

export interface BuildMessageInput {
  readonly id?: string;
  readonly content?: string;
  readonly authorId?: string;
  readonly authorBot?: boolean;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly sink?: MessageMockSink;
}

export const buildMessage = (input: BuildMessageInput = {}): Message => {
  const sink = input.sink ?? { reactions: [], replies: [], edits: [] };
  return {
    id: input.id ?? 'm-1',
    content: input.content ?? '',
    guildId: input.guildId ?? 'g-1',
    channelId: input.channelId ?? 'c-1',
    author: {
      id: input.authorId ?? 'u-1',
      bot: input.authorBot ?? false,
      username: 'tester',
    },
    react: async (emoji: string) => {
      sink.reactions.push(String(emoji));
    },
    reply: async (opts: { content: string }) => {
      sink.replies.push(opts.content);
      return buildMessage({ ...input, id: 'reply-of-' + (input.id ?? 'm-1') });
    },
    edit: async (opts: { content: string }) => {
      sink.edits.push(opts.content);
      return buildMessage({ ...input, content: opts.content });
    },
  } as unknown as Message;
};
