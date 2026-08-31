/**
 * Clamp emoji_frequency user inputs to safe upper bounds. The caps
 * are policy decisions about how much work the command will spend
 * per invocation; we centralise them so future tuning is one edit.
 */
const MAX_TOP_N = 30;
const MAX_LAST_N_MONTHS = 24;

interface EmojiFrequencyOptions {
  readonly topN: number;
  readonly lastNMonths: number;
}

export const clampOptions = (opts: EmojiFrequencyOptions): EmojiFrequencyOptions => ({
  topN: Math.min(opts.topN, MAX_TOP_N),
  lastNMonths: Math.min(opts.lastNMonths, MAX_LAST_N_MONTHS),
});
