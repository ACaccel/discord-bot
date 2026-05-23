/**
 * Split a list of lines into Discord-sendable chunks no longer than
 * `maxLen` characters (default 1900, leaving headroom under the 2000
 * hard limit). Pure: the inputs are primitive strings, the output is
 * a fresh array — no I/O, no mutation of `lines`.
 */
const DEFAULT_MAX_LEN = 1900;

export const chunkLines = (
  lines: ReadonlyArray<string>,
  maxLen: number = DEFAULT_MAX_LEN,
): string[] => {
  if (lines.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const add = (current ? '\n' : '') + line;
    if (current.length + add.length > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += add;
    }
  }
  if (current) chunks.push(current);

  return chunks;
};
