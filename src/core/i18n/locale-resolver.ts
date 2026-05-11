import { DEFAULT_LOCALE, type Locale } from './translator';

const SUPPORTED: ReadonlySet<Locale> = new Set<Locale>(['zh-TW', 'en']);

export interface LocaleResolutionInputs {
  /** User-level preference (from UserApiSetting or similar). */
  userLocale?: string | null;
  /** Guild-level default. */
  guildLocale?: string | null;
  /** Discord `interaction.locale` (e.g. 'zh-TW', 'en-US'). */
  interactionLocale?: string | null;
}

/**
 * Locale resolution priority (highest → lowest):
 *   1. user preference   2. guild default   3. Discord interaction locale   4. fallback
 *
 * Each candidate is normalised via {@link normalizeDiscordLocale}, which
 * collapses regional variants (Discord sends `en-US`, `en-GB`, etc.; we
 * support only `en`) and strips unsupported tags.
 */
export const resolveLocale = (
  inputs: LocaleResolutionInputs,
  fallback: Locale = DEFAULT_LOCALE,
): Locale => {
  const candidates = [inputs.userLocale, inputs.guildLocale, inputs.interactionLocale];
  for (const candidate of candidates) {
    const normalised = normalizeDiscordLocale(candidate);
    if (normalised !== undefined) return normalised;
  }
  return fallback;
};

/**
 * Map a Discord locale tag (or anything else) to one of our supported
 * {@link Locale} values, or `undefined` when no support exists.
 *
 * Examples:
 *   'zh-TW' → 'zh-TW'
 *   'en-US' → 'en'
 *   'en-GB' → 'en'
 *   'ja'    → undefined
 */
export const normalizeDiscordLocale = (value: string | null | undefined): Locale | undefined => {
  if (typeof value !== 'string' || value.length === 0) return undefined;

  if (SUPPORTED.has(value as Locale)) return value as Locale;

  const lower = value.toLowerCase();
  if (lower === 'zh-tw' || lower === 'zh-hant' || lower === 'zh-hant-tw') return 'zh-TW';
  if (lower.startsWith('en')) return 'en';
  return undefined;
};
