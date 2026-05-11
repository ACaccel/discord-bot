/**
 * Translator abstraction.
 *
 * Phase 0 only ships the contract + a default i18next-backed
 * implementation and seeds the zh-TW catalog. Phase 6 wires this
 * through every user-facing boundary and enforces no-literal-string
 * lint rules.
 *
 * Adding a new locale requires only:
 *   1. add a value to the `Locale` union below
 *   2. drop a parallel JSON folder under src/interface/locales/<locale>/
 *   3. the catalog-completeness test will fail until keys match
 *
 * Application/interface code receives a `Translator` via constructor
 * injection so tests can substitute a deterministic fake.
 *
 * Placeholder syntax invariant: catalogs use i18next's `{{name}}` form,
 * NOT single-brace ICU. The two formats are incompatible; do not switch
 * without migrating every catalog entry in lockstep.
 */
export type Locale = 'zh-TW' | 'en';

export const DEFAULT_LOCALE: Locale = 'zh-TW';

export type TranslationParams = Readonly<Record<string, string | number>>;

/**
 * String literal type alias for translation keys.
 *
 * Today this is `string`; Phase 6 will narrow it to a union generated
 * from the zh-TW catalog. Call sites should already import this name
 * rather than typing `string` directly, so the narrowing later is a
 * pure compile-time tightening.
 */
export type TranslationKey = string;

export class MissingTranslationError extends Error {
  public readonly key: TranslationKey;
  public readonly locale: Locale;

  public constructor(key: TranslationKey, locale: Locale) {
    super(`Missing translation: key="${key}" locale="${locale}"`);
    this.name = 'MissingTranslationError';
    this.key = key;
    this.locale = locale;
  }
}

export interface Translator {
  /**
   * Translate a key for the given (or default) locale.
   * Returns the key string itself when missing — never throws — so a
   * forgotten translation degrades gracefully in production while the
   * catalog-completeness CI gate catches it before merge.
   */
  t(key: TranslationKey, params?: TranslationParams, locale?: Locale): string;

  /**
   * Strict translate — throws {@link MissingTranslationError} when the
   * key is absent in the requested locale (with fallback). Use in tests
   * and in dev-mode assertions; not in production handlers.
   */
  tStrict(key: TranslationKey, params?: TranslationParams, locale?: Locale): string;

  /**
   * Report which keys are missing in each locale compared to `reference`.
   * Used by the catalog-completeness test.
   */
  listMissingKeys(reference: Locale): Record<Locale, readonly string[]>;
}
