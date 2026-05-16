/**
 * Bind a Translator (or `undefined`) into a single-argument `t(key, params)`
 * function. Used at call sites that want to call `t('replies:x.y', {...})`
 * many times without re-checking `bot.translator` for null on every call.
 *
 * Fallback contract: when the translator is unavailable, return the key
 * itself rather than an empty string. Discord rejects empty `content`, so
 * silently returning '' converted a config bug (translator not loaded)
 * into a user-visible "create_failed" reply with no operator signal.
 * Returning the key surfaces the missing-translator condition in the
 * channel where ops can see it, and matches the {@link Translator.t}
 * graceful-degrade contract.
 */
import type { Translator, TranslationKey, TranslationParams } from './translator';

export type BoundTranslate = (key: TranslationKey, params?: TranslationParams) => string;

export const bindTranslator = (translator: Translator | undefined): BoundTranslate => {
  if (translator === undefined) {
    return (key) => key;
  }
  return (key, params) => translator.t(key, params);
};
