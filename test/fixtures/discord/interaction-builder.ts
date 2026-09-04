/**
 * Minimal ChatInputCommandInteraction builder. Captures every reply via
 * the `sink` so assertions can read deferReply / reply / editReply /
 * followUp in order — including the flags each was sent with, which is
 * the only way a test can see that a reply stayed ephemeral.
 */
import type { ChatInputCommandInteraction, Guild } from 'discord.js';

import { buildGuild } from './guild-builder';

/** What a send path records. `flags` carries `MessageFlags.Ephemeral`. */
interface SentMessage {
  readonly content?: string;
  readonly flags?: number;
}

interface InteractionMockSink {
  /** `deferReply` calls, with the flags the handler deferred under. */
  readonly defers: Array<{ flags?: number }>;
  readonly replies: SentMessage[];
  readonly editReplies: Array<{ content?: string }>;
  /** Follow-ups in order — the overflow pages of a paginated reply. */
  readonly followUps: SentMessage[];
  /** Acknowledgement state, mirroring what discord.js tracks. */
  readonly acknowledged: { deferred: boolean; replied: boolean };
}

/**
 * The structural minimum a resolved channel option needs. Handlers read
 * the id and resolve the real channel from the guild cache, so a
 * builder returning a full channel would invite assertions on fields
 * the handler never touches.
 */
interface ResolvedChannelOption {
  readonly id: string;
}

interface BuildChatInputInteractionInput {
  readonly commandName?: string;
  readonly userId?: string;
  readonly guildId?: string | null;
  readonly options?: Readonly<Record<string, string | number | boolean | null>>;
  /** Values `options.getChannel(name)` resolves, keyed by option name. */
  readonly channels?: Readonly<Record<string, ResolvedChannelOption>>;
  /** The invoking channel; also backs `interaction.channelId`. */
  readonly channel?: ResolvedChannelOption | null;
  /** Overrides the default `buildGuild({ id: guildId })`. */
  readonly guild?: Guild;
  /** When the interaction was created; defaults to now. */
  readonly createdTimestamp?: number;
  readonly sink?: InteractionMockSink;
}

const newSink = (): InteractionMockSink => ({
  defers: [],
  replies: [],
  editReplies: [],
  followUps: [],
  acknowledged: { deferred: false, replied: false },
});

export const buildChatInputInteraction = (
  input: BuildChatInputInteractionInput = {},
): ChatInputCommandInteraction => {
  const sink = input.sink ?? newSink();
  const options = input.options ?? {};
  const channels = input.channels ?? {};
  // A guild passed explicitly is authoritative for both fields, so
  // `interaction.guild.id` and `interaction.guildId` cannot disagree.
  const guild =
    input.guild ?? (input.guildId === null ? null : buildGuild({ id: input.guildId ?? 'g-1' }));
  return {
    isChatInputCommand: () => true,
    isContextMenuCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isAutocomplete: () => false,
    commandName: input.commandName ?? 'noop',
    user: { id: input.userId ?? 'u-1', displayName: 'tester' },
    guild,
    guildId: guild?.id ?? null,
    channel: input.channel ?? null,
    channelId: input.channel?.id ?? 'c-1',
    locale: 'zh-TW',
    // Discord stamps every interaction; `/feed_subscribe` measures its
    // batch budget from this, so a fixture without it would silently
    // disable the deadline instead of exercising it.
    createdTimestamp: input.createdTimestamp ?? Date.now(),
    // Live acknowledgement state, so a handler's error boundary picks
    // `editReply` over `reply` exactly as it would at runtime — and so
    // a double-reply bug shows up here instead of only in production.
    get deferred(): boolean {
      return sink.acknowledged.deferred;
    },
    get replied(): boolean {
      return sink.acknowledged.replied;
    },
    options: {
      get: (name: string) =>
        Object.prototype.hasOwnProperty.call(options, name) ? { value: options[name] } : null,
      getString: (name: string) => (options[name] as string | undefined) ?? null,
      getInteger: (name: string) => (options[name] as number | undefined) ?? null,
      getChannel: (name: string) => channels[name] ?? null,
    },
    deferReply: async (opts?: { flags?: number }) => {
      sink.defers.push(opts ?? {});
      sink.acknowledged.deferred = true;
    },
    reply: async (opts: SentMessage) => {
      sink.replies.push(opts);
      sink.acknowledged.replied = true;
    },
    editReply: async (opts: { content?: string }) => {
      sink.editReplies.push(opts);
    },
    followUp: async (opts: SentMessage) => {
      sink.followUps.push(opts);
    },
  } as unknown as ChatInputCommandInteraction;
};

export const newInteractionSink = newSink;
