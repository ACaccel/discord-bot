import { buildReactionText, type ReactionLike } from './render-reactions';

/**
 * Structural view of an archived message — only the fields
 * formatMessageLines reads. Decoupling from Mongoose's Subdocument
 * type keeps the helper easy to unit-test with plain literals.
 */
export interface MessageLike {
  readonly userId: string;
  readonly userName?: string | null;
  readonly content?: string | null;
  readonly timestamp: number | string;
  readonly attachments?: ReadonlyArray<{
    readonly id?: string | null;
    readonly name?: string | null;
    readonly url?: string | null;
  }> | null;
  readonly stickers?: ReadonlyArray<{
    readonly id?: string | null;
    readonly name?: string | null;
  }> | null;
  readonly reactions?: ReadonlyArray<ReactionLike & { readonly count?: number | null }> | null;
}

/**
 * Convert a slice of archived messages into displayable lines. The
 * function is async only because the caller passes a display-name
 * resolver that may hit the Discord cache or REST — but the resolver
 * is a seam, so the helper can be unit-tested with a plain in-memory
 * map without any Discord dependency.
 *
 * Truncation lives here too: the display-name max length is a layout
 * concern of the rendered line, not a property of the resolver.
 */
const DEFAULT_DISPLAY_NAME_MAX = 10;

const truncateDisplayName = (name: string, maxLength: number): string => {
  if (name.length <= maxLength) return name;
  return name.slice(0, maxLength) + '...';
};

export interface FormatMessageLinesOptions {
  readonly resolveDisplayName: (userId: string, fallback: string) => Promise<string>;
  readonly truncateAt?: number;
}

export const formatMessageLines = async (
  messages: ReadonlyArray<MessageLike>,
  opts: FormatMessageLinesOptions,
): Promise<string[]> => {
  const truncateAt = opts.truncateAt ?? DEFAULT_DISPLAY_NAME_MAX;
  const lines: string[] = [];

  for (const msg of messages) {
    const userName = msg.userName || 'unknown';
    const rawDisplayName = await opts.resolveDisplayName(msg.userId, userName);
    const shortDisplayName = truncateDisplayName(rawDisplayName, truncateAt);

    const tsNum = typeof msg.timestamp === 'string' ? Number(msg.timestamp) : msg.timestamp;
    const dateObj = new Date(tsNum || 0);
    const hh = dateObj.getHours().toString().padStart(2, '0');
    const mm = dateObj.getMinutes().toString().padStart(2, '0');
    const prefix = `*${hh}:${mm}* **${shortDisplayName} (${userName})**: `;

    const lineStartIndex = lines.length;

    const content = (msg.content || '').trimEnd();
    if (content.length > 0) {
      const parts = content.split('\n');
      lines.push(prefix + parts[0]);
      for (const extra of parts.slice(1)) {
        lines.push(extra);
      }
    }

    const attachments = msg.attachments || [];
    for (const a of attachments) {
      const name = a.name || a.id || 'unknown_attachment';
      const url = a.url ? ` - ${a.url}` : '';
      lines.push(`${prefix}attachment - ${name}${url}`);
    }

    const stickers = msg.stickers || [];
    for (const s of stickers) {
      lines.push(`${prefix}sticker - ${s.name || s.id || 'unknown_sticker'}`);
    }

    const reactions = msg.reactions || [];
    const reactionParts: string[] = [];
    for (const r of reactions) {
      const count = typeof r.count === 'number' ? r.count : 0;
      reactionParts.push(`${buildReactionText(r)} x${count}`);
    }

    if (content.length === 0 && attachments.length === 0 && stickers.length === 0) {
      lines.push(`${prefix}[empty]`);
    }

    if (reactionParts.length > 0 && lines.length > lineStartIndex) {
      lines[lineStartIndex] += ` [reactions: ${reactionParts.join(', ')}]`;
    }
  }

  return lines;
};
