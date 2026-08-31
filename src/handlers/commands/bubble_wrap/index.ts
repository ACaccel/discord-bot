import type { ChatInputCommandInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import { getRequiredString } from '../../../infra/discord/options';

/**
 * Fisher-Yates over a copy. The bounds check is unreachable — `i` and
 * `j` are both below `out.length` by construction — but reading through
 * locals keeps the shuffle free of index casts.
 */
const shuffle = (values: readonly number[]): number[] => {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
};

export default class bubble_wrap extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'bubble_wrap',
      category: 'fun',
      options: {
        string: [
          {
            name: 'str',
            required: true,
          },
        ],
      },
    });
  }
  private getVisualWidth(char: string): number {
    // eslint-disable-next-line no-control-regex
    return /[^\x00-\xff]/.test(char) ? 2 : 1;
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
  ): Promise<void> {
    const inner_str = getRequiredString(interaction, 'str');
    const side_len = 7;
    // The guard counts UTF-16 units while placement below counts code
    // points, deliberately: an astral character costs two units but one
    // cell, so the guard can only over-reject, never overflow the board.
    if (inner_str.length > side_len * side_len) {
      await interaction.reply({ content: bot.translator?.t('replies:bubble_wrap.too_long') ?? '' });
      return;
    }

    // Where each character lands: a random permutation of every cell,
    // trimmed to the characters actually supplied (the length guard
    // above keeps that a prefix of the permutation).
    const chars = [...inner_str];
    const slots = shuffle(Array.from({ length: side_len * side_len }, (_, i) => i)).slice(
      0,
      chars.length,
    );

    const board: string[] = Array(side_len * side_len).fill('||<:blank:1082500408838205540>||');
    for (const [index, place] of slots.entries()) {
      const char = chars[index];
      if (char === undefined) continue;
      // Pad narrow characters so every cell renders the same width.
      const displayChar = this.getVisualWidth(char) === 1 ? `  ${char}  ` : ` ${char} `;
      board[place] = `||${displayChar}||`;
    }

    // create the string representation of the board
    let inf = '';
    for (let i = 0; i < side_len; i++) {
      inf += board.slice(i * side_len, (i + 1) * side_len).join('') + '\n';
    }

    await interaction.reply({ content: inf });
  }
}
