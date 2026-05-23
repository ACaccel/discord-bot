/**
 * Structural view of a persisted reaction row. We rely only on the
 * fields buildReactionText reads, so tests can construct fixtures
 * without dragging in Mongoose Subdocument internals.
 */
export interface ReactionLike {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly animated?: boolean | null;
}

/**
 * Render one persisted reaction entry as Discord-displayable text.
 * Custom emoji become `<:name:id>` / `<a:name:id>`, unicode emoji
 * fall back to their name, and partially-stored rows render as a
 * literal placeholder so the missing data is obvious in the output.
 */
export const buildReactionText = (reaction: ReactionLike): string => {
  const name = reaction.name ?? '';
  const id = reaction.id ?? '';
  const animated = Boolean(reaction.animated);

  if (id && name) {
    return `<${animated ? 'a:' : ':'}${name}:${id}>`;
  }

  if (name) return name;
  return '[unknown_reaction]';
};
