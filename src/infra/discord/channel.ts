import type { Channel } from 'discord.js';

/**
 * The parent channel id of a thread (its forum / text-channel parent), or
 * `null` for a top-level channel or any channel type without a parent.
 *
 * A single safe extraction so every caller derives the parent the same way:
 * the `'parentId' in channel` guard replaces the unchecked
 * `(channel as TextChannel).parentId` cast that several call sites used, and
 * normalises discord.js's `string | null` to a plain `string | null`.
 */
export const parentChannelIdOf = (channel: Channel | null | undefined): string | null => {
  if (channel === null || channel === undefined) return null;
  return 'parentId' in channel ? (channel.parentId ?? null) : null;
};
