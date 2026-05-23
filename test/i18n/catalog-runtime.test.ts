import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { I18NextTranslator } from '../../src/core/i18n/i18next-translator';
import { loadCatalogResources } from '../../src/core/i18n/catalog-loader';

/**
 * R5: the loader no longer reverse-resolves `src/i18n/locales` from
 * its own `__dirname`. This test file is part of the composition
 * surface (it asserts behaviour against the real deployed catalogs),
 * so it owns the path knowledge and injects it explicitly.
 */
const LOCALES_DIR = path.resolve(__dirname, '..', '..', 'src', 'i18n', 'locales');

/**
 * Runtime catalog checks (gaps D7 / D9).
 *
 * Unlike `catalog-completeness.test.ts` — which inspects the raw JSON files
 * for cross-locale key/placeholder parity — this suite loads the on-disk
 * catalogs through the real `loadCatalogResources` + `I18NextTranslator`
 * pipeline and asserts the behaviour C6 depends on:
 *
 * - D7: the `en` locale resolves real keys, and a key missing in `en`
 *   degrades gracefully by falling back to `zh-TW`.
 * - D9: every per-feature `replies:<feature>.failed` fallback string carries
 *   the `{{traceId}}` interpolation slot so `replyForError` can surface a
 *   trace code for non-DomainError failures.
 */
describe('catalog runtime behaviour', () => {
  it('loads both locales from disk', () => {
    const resources = loadCatalogResources({ localesDir: LOCALES_DIR });
    expect(Object.keys(resources).sort()).toEqual(['en', 'zh-TW']);
  });

  it('resolves command metadata for the en locale', async () => {
    const translator = await I18NextTranslator.create(
      loadCatalogResources({ localesDir: LOCALES_DIR }),
    );
    expect(translator.t('commands:add_reply.description', undefined, 'en')).toBe(
      'Add an auto-reply',
    );
    expect(translator.t('commands:add_reply.description', undefined, 'zh-TW')).toBe('新增自動回覆');
  });

  it('reports zero missing keys between zh-TW and en', async () => {
    const translator = await I18NextTranslator.create(
      loadCatalogResources({ localesDir: LOCALES_DIR }),
    );
    const missing = translator.listMissingKeys('zh-TW');
    expect(missing['zh-TW']).toEqual([]);
    expect(missing.en).toEqual([]);
  });

  it('falls back to zh-TW when a key is absent in the requested locale', async () => {
    // Inject a deliberately en-incomplete catalog: the loader keeps zh-TW
    // intact, so a missing en key must degrade to the fallback locale
    // rather than throwing or returning the bare key.
    const resources = loadCatalogResources({ localesDir: LOCALES_DIR });
    const trimmedEn = {
      ...resources,
      en: {
        ...resources.en,
        replies: { ...resources.en.replies },
      },
    };
    delete (trimmedEn.en.replies as Record<string, unknown>).help;
    const translator = await I18NextTranslator.create(trimmedEn, 'zh-TW');
    expect(translator.t('replies:help.no_commands', undefined, 'en')).toBe('沒有指令清單');
  });

  it('resolves every errors:db.* DatabaseError messageKey with no leftover placeholder', async () => {
    // The five DatabaseErrorCode sub-codes map to these keys via
    // `error-translator.i18nKeyFor`. `databaseErrorFrom` passes no
    // `messageParams`, so none of these texts may carry an interpolation
    // slot — otherwise a raw `{{...}}` token would leak into the reply.
    const translator = await I18NextTranslator.create(
      loadCatalogResources({ localesDir: LOCALES_DIR }),
    );
    const dbKeys = [
      'errors:db.duplicate_key',
      'errors:db.timeout',
      'errors:db.network',
      'errors:db.validation',
      'errors:db.unavailable',
    ] as const;
    for (const locale of ['zh-TW', 'en'] as const) {
      for (const key of dbKeys) {
        const resolved = translator.t(key, undefined, locale);
        expect(resolved, `${key} (${locale}) must resolve to a real string`).not.toBe(key);
        expect(resolved.length, `${key} (${locale}) must be non-empty`).toBeGreaterThan(0);
        expect(
          /\{\{\s*\w+\s*\}\}/.test(resolved),
          `${key} (${locale}) must not contain an uninterpolated placeholder`,
        ).toBe(false);
      }
    }
  });

  it('keeps a {{traceId}} slot in every per-feature failed fallback string', () => {
    const resources = loadCatalogResources({ localesDir: LOCALES_DIR });
    for (const locale of ['zh-TW', 'en'] as const) {
      const replies = resources[locale].replies as Record<string, unknown>;
      for (const [feature, value] of Object.entries(replies)) {
        if (value === null || typeof value !== 'object') continue;
        const failed = (value as Record<string, unknown>).failed;
        if (typeof failed !== 'string') continue;
        expect(
          failed.includes('{{traceId}}'),
          `replies:${feature}.failed (${locale}) must carry a {{traceId}} interpolation slot`,
        ).toBe(true);
      }
    }
  });
});
