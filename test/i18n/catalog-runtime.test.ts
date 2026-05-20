import { describe, expect, it } from 'vitest';

import { I18NextTranslator } from '../../src/core/i18n/i18next-translator';
import { loadCatalogResources } from '../../src/core/i18n/catalog-loader';

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
    const resources = loadCatalogResources();
    expect(Object.keys(resources).sort()).toEqual(['en', 'zh-TW']);
  });

  it('resolves command metadata for the en locale', async () => {
    const translator = await I18NextTranslator.create(loadCatalogResources());
    expect(translator.t('commands:add_reply.description', undefined, 'en')).toBe(
      'Add an auto-reply',
    );
    expect(translator.t('commands:add_reply.description', undefined, 'zh-TW')).toBe('新增自動回覆');
  });

  it('reports zero missing keys between zh-TW and en', async () => {
    const translator = await I18NextTranslator.create(loadCatalogResources());
    const missing = translator.listMissingKeys('zh-TW');
    expect(missing['zh-TW']).toEqual([]);
    expect(missing.en).toEqual([]);
  });

  it('falls back to zh-TW when a key is absent in the requested locale', async () => {
    // Inject a deliberately en-incomplete catalog: the loader keeps zh-TW
    // intact, so a missing en key must degrade to the fallback locale
    // rather than throwing or returning the bare key.
    const resources = loadCatalogResources();
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

  it('keeps a {{traceId}} slot in every per-feature failed fallback string', () => {
    const resources = loadCatalogResources();
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
