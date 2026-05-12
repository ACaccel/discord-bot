import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createDefaultTranslator,
  loadCatalogResources,
} from '../../../../src/core/i18n/catalog-loader';

const writeLocale = (
  root: string,
  locale: string,
  catalogs: Record<string, Record<string, unknown>>,
): void => {
  const dir = path.join(root, locale);
  fs.mkdirSync(dir, { recursive: true });
  for (const [ns, body] of Object.entries(catalogs)) {
    fs.writeFileSync(path.join(dir, `${ns}.json`), JSON.stringify(body));
  }
};

describe('catalog-loader', () => {
  it('loads every namespace JSON under the given locales directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-loader-'));
    try {
      writeLocale(tmp, 'zh-TW', {
        replies: { greeting: '你好,{{name}}' },
        errors: { boom: '炸了' },
        commands: {},
      });
      const resources = loadCatalogResources({ localesDir: tmp });
      expect(resources['zh-TW']?.replies['greeting']).toBe('你好,{{name}}');
      expect(resources['zh-TW']?.errors['boom']).toBe('炸了');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('treats missing namespace files as empty objects rather than throwing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-loader-'));
    try {
      writeLocale(tmp, 'zh-TW', { replies: { hi: '嗨' } });
      // No commands.json, no errors.json — should degrade gracefully.
      const resources = loadCatalogResources({ localesDir: tmp });
      expect(resources['zh-TW']?.commands).toEqual({});
      expect(resources['zh-TW']?.errors).toEqual({});
      expect(resources['zh-TW']?.replies['hi']).toBe('嗨');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws an actionable error when the locales directory does not exist', () => {
    expect(() =>
      loadCatalogResources({
        localesDir: path.join(os.tmpdir(), 'definitely-not-a-real-dir-xyz123'),
      }),
    ).toThrow(/locales directory not found/);
  });

  it('createDefaultTranslator returns a Translator that can resolve a known key', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-loader-'));
    try {
      writeLocale(tmp, 'zh-TW', {
        replies: { ping: 'pong' },
        errors: {},
        commands: {},
      });
      const translator = await createDefaultTranslator({ localesDir: tmp });
      expect(translator.t('replies:ping')).toBe('pong');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
