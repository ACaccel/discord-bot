/**
 * Minimal ChatInputCommandInteraction builder. Captures every reply
 * via the `sink` so assertions can read replies / deferReply /
 * editReply in order.
 */
import type { ChatInputCommandInteraction } from 'discord.js';

import { buildGuild } from './guild-builder';

interface InteractionMockSink {
  readonly replies: Array<{ content?: string; ephemeral?: boolean }>;
  readonly editReplies: Array<{ content?: string }>;
  readonly deferred: { value: boolean };
}

interface BuildChatInputInteractionInput {
  readonly commandName?: string;
  readonly userId?: string;
  readonly guildId?: string | null;
  readonly options?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sink?: InteractionMockSink;
}

const newSink = (): InteractionMockSink => ({
  replies: [],
  editReplies: [],
  deferred: { value: false },
});

export const buildChatInputInteraction = (
  input: BuildChatInputInteractionInput = {},
): ChatInputCommandInteraction => {
  const sink = input.sink ?? newSink();
  const options = input.options ?? {};
  return {
    isChatInputCommand: () => true,
    isContextMenuCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isAutocomplete: () => false,
    commandName: input.commandName ?? 'noop',
    user: { id: input.userId ?? 'u-1', displayName: 'tester' },
    guild: input.guildId === null ? null : buildGuild({ id: input.guildId ?? 'g-1' }),
    guildId: input.guildId === null ? null : (input.guildId ?? 'g-1'),
    channelId: 'c-1',
    locale: 'zh-TW',
    options: {
      get: (name: string) =>
        Object.prototype.hasOwnProperty.call(options, name) ? { value: options[name] } : null,
      getString: (name: string) => (options[name] as string | undefined) ?? null,
      getInteger: (name: string) => (options[name] as number | undefined) ?? null,
    },
    deferReply: async () => {
      sink.deferred.value = true;
    },
    reply: async (opts: { content?: string; ephemeral?: boolean }) => {
      sink.replies.push(opts);
    },
    editReply: async (opts: { content?: string }) => {
      sink.editReplies.push(opts);
    },
  } as unknown as ChatInputCommandInteraction;
};

export const newInteractionSink = newSink;
