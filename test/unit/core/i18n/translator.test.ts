import { describe, expect, it } from 'vitest';
import { I18NextTranslator, MissingTranslationError } from '../../../../src/core/i18n';

const resources = {
  'zh-TW': {
    commands: {},
    errors: {
      llm: { rate_limited: '請於 {{retryAfter}} 秒後再試。' },
      command: { not_found: '找不到指令 /{{name}}' },
      unexpected: '發生未預期錯誤。',
    },
    replies: {},
  },
  en: {
    commands: {},
    errors: {
      llm: { rate_limited: 'Try again in {{retryAfter}} seconds.' },
      command: { not_found: 'Command /{{name}} not found' },
    },
    replies: {},
  },
} as const;

describe('I18NextTranslator', () => {
  it('translates a key with interpolation for the default locale', async () => {
    const t = await I18NextTranslator.create(resources);
    expect(t.t('errors:llm.rate_limited', { retryAfter: 30 })).toBe('請於 30 秒後再試。');
  });

  it('translates for an explicit locale', async () => {
    const t = await I18NextTranslator.create(resources);
    expect(t.t('errors:llm.rate_limited', { retryAfter: 30 }, 'en')).toBe(
      'Try again in 30 seconds.',
    );
  });

  it('falls back to the default locale when a key is missing in the requested locale', async () => {
    const t = await I18NextTranslator.create(resources);
    expect(t.t('errors:unexpected', undefined, 'en')).toBe('發生未預期錯誤。');
  });

  it('falls back to the key (i18next default) when the key is missing in every locale', async () => {
    const t = await I18NextTranslator.create(resources);
    // i18next strips the namespace prefix on miss; we accept that contract
    // because the catalog-completeness CI gate prevents shipping misses.
    expect(t.t('errors:nope.absent')).toBe('nope.absent');
  });

  describe('tStrict', () => {
    it('returns the translation on hit', async () => {
      const t = await I18NextTranslator.create(resources);
      expect(t.tStrict('errors:llm.rate_limited', { retryAfter: 5 })).toBe('請於 5 秒後再試。');
    });

    it('throws MissingTranslationError when the key is absent everywhere', async () => {
      const t = await I18NextTranslator.create(resources);
      expect(() => t.tStrict('errors:totally.missing')).toThrow(MissingTranslationError);
    });
  });

  describe('listMissingKeys', () => {
    it('reports keys present in the reference locale but absent in others', async () => {
      const t = await I18NextTranslator.create(resources);
      const missing = t.listMissingKeys('zh-TW');
      expect(missing['zh-TW']).toEqual([]);
      expect(missing.en).toContain('errors:unexpected');
      expect(missing.en).not.toContain('errors:llm.rate_limited');
    });
  });
});
