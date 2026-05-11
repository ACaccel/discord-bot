import i18next, { type i18n as I18NextInstance } from 'i18next';
import {
  DEFAULT_LOCALE,
  MissingTranslationError,
  type Locale,
  type TranslationKey,
  type TranslationParams,
  type Translator,
} from './translator';

const NAMESPACES = ['commands', 'errors', 'replies'] as const;
type Namespace = (typeof NAMESPACES)[number];

export type CatalogResources = Readonly<
  Record<Locale, Readonly<Record<Namespace, Record<string, unknown>>>>
>;

/**
 * Default Translator implementation backed by i18next.
 *
 * Initialised from in-memory catalogs that the caller assembles from the
 * JSON files under `src/interface/locales/`. Kept intentionally small —
 * i18next handles interpolation, fallback, and nested key lookup.
 *
 * Placeholder syntax: i18next default `{{name}}` (NOT single-brace ICU).
 * Escape invariant: `interpolation.escapeValue: false` because Discord
 * renders backslash escapes literally; every catalog entry is hand-authored
 * and never user-supplied, so the XSS-style escaping is harmful here.
 */
export class I18NextTranslator implements Translator {
  private readonly instance: I18NextInstance;
  private readonly resources: CatalogResources;
  private readonly fallback: Locale;

  private constructor(instance: I18NextInstance, resources: CatalogResources, fallback: Locale) {
    this.instance = instance;
    this.resources = resources;
    this.fallback = fallback;
  }

  public static async create(
    resources: CatalogResources,
    fallbackLocale: Locale = DEFAULT_LOCALE,
  ): Promise<I18NextTranslator> {
    const instance = i18next.createInstance();
    await instance.init({
      lng: fallbackLocale,
      fallbackLng: fallbackLocale,
      defaultNS: 'replies',
      ns: [...NAMESPACES],
      resources: resources as never,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    return new I18NextTranslator(instance, resources, fallbackLocale);
  }

  public t(key: TranslationKey, params?: TranslationParams, locale?: Locale): string {
    return this.instance.t(key, { ...(params ?? {}), lng: locale });
  }

  public tStrict(key: TranslationKey, params?: TranslationParams, locale?: Locale): string {
    const requested = locale ?? this.fallback;
    if (!this.instance.exists(key, { lng: requested })) {
      throw new MissingTranslationError(key, requested);
    }
    return this.t(key, params, locale);
  }

  public listMissingKeys(reference: Locale): Record<Locale, readonly string[]> {
    const referenceKeys = collectLeafKeys(this.resources[reference]);
    const result: Partial<Record<Locale, readonly string[]>> = {};
    for (const locale of Object.keys(this.resources) as Locale[]) {
      if (locale === reference) {
        result[locale] = [];
        continue;
      }
      const localeKeys = new Set(collectLeafKeys(this.resources[locale]));
      result[locale] = referenceKeys.filter((k) => !localeKeys.has(k));
    }
    return result as Record<Locale, readonly string[]>;
  }
}

const collectLeafKeys = (
  catalog: Readonly<Record<Namespace, Record<string, unknown>>>,
): string[] => {
  const keys: string[] = [];
  for (const ns of NAMESPACES) {
    walk(catalog[ns], `${ns}:`, keys);
  }
  return keys.sort();
};

const walk = (node: unknown, prefix: string, out: string[]): void => {
  if (node === null || typeof node !== 'object') {
    out.push(prefix.replace(/\.$/, ''));
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const next = prefix.endsWith(':') ? `${prefix}${k}` : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object') {
      walk(v, `${next}.`, out);
    } else {
      out.push(next);
    }
  }
};
