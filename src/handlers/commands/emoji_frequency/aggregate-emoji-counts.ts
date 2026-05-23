/**
 * Pure aggregation primitives for emoji_frequency. The handler reads
 * messages a month at a time and folds each batch into the same
 * counters; keeping the counter shape + accumulator together makes
 * that loop testable without touching the Discord SDK or the repo.
 */
export interface EmojiCounts {
  readonly text: Map<string, number>;
  readonly reaction: Map<string, number>;
}

export interface MessageLike {
  readonly content?: string | null;
  readonly reactions?: ReadonlyArray<{
    readonly id?: string | null;
    readonly name?: string | null;
    readonly animated?: boolean | null;
    readonly count?: number | null;
  }> | null;
}

const EMOJI_TEXT_PATTERN = /<a?:\w+:\d+>/g;

/**
 * Seed both counter Maps with every known guild emoji at zero. Only
 * emojis present here can ever increment — unknown emojis in old
 * messages are ignored, matching the legacy behaviour.
 */
export const initEmojiCounts = (emojiTexts: ReadonlyArray<string>): EmojiCounts => {
  const text = new Map<string, number>();
  const reaction = new Map<string, number>();
  for (const e of emojiTexts) {
    text.set(e, 0);
    reaction.set(e, 0);
  }
  return { text, reaction };
};

/**
 * Fold a slice of messages into the running counters. The counts
 * object is mutated in place so callers can stream millions of
 * messages without rebuilding intermediate Maps.
 */
export const accumulateEmojiCounts = (
  messages: ReadonlyArray<MessageLike>,
  counts: EmojiCounts,
): void => {
  for (const message of messages) {
    const matches = message.content?.match(EMOJI_TEXT_PATTERN) ?? [];
    for (const emoji of matches) {
      if (counts.text.has(emoji)) {
        counts.text.set(emoji, (counts.text.get(emoji) ?? 0) + 1);
      }
    }
    const reactions = message.reactions ?? [];
    for (const reaction of reactions) {
      const emojiText = `<${reaction.animated ? 'a:' : ':'}${reaction.name}:${reaction.id}>`;
      if (counts.reaction.has(emojiText)) {
        counts.reaction.set(
          emojiText,
          (counts.reaction.get(emojiText) ?? 0) + (reaction.count ?? 0),
        );
      }
    }
  }
};
