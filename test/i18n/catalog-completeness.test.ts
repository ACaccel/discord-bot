import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Catalog completeness check.
 *
 * - Each locale folder under src/i18n/locales/ must contain the same
 *   set of namespace files.
 * - Each namespace's leaf-key set must match across locales.
 * - Each leaf value's ICU placeholders (i18next {{...}} syntax) must match
 *   across locales.
 *
 * Parity checks run across whichever locales are present, locking in the
 * schema and catching a malformed JSON file or an empty/missing namespace.
 */
const LOCALES_DIR = path.resolve(__dirname, '../../src/i18n/locales');

interface ParsedLocale {
  readonly locale: string;
  readonly namespaces: ReadonlyMap<string, Record<string, unknown>>;
}

const readLocale = (locale: string): ParsedLocale => {
  const dir = path.join(LOCALES_DIR, locale);
  const namespaces = new Map<string, Record<string, unknown>>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const ns = path.basename(file, '.json');
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    namespaces.set(ns, JSON.parse(raw) as Record<string, unknown>);
  }
  return { locale, namespaces };
};

const collectKeys = (root: Record<string, unknown>, prefix = ''): string[] => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(root)) {
    const full = prefix.length === 0 ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...collectKeys(v as Record<string, unknown>, full));
    } else {
      out.push(full);
    }
  }
  return out.sort();
};

const collectPlaceholders = (
  root: Record<string, unknown>,
  acc: Map<string, ReadonlyArray<string>>,
  prefix = '',
): void => {
  for (const [k, v] of Object.entries(root)) {
    const full = prefix.length === 0 ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      collectPlaceholders(v as Record<string, unknown>, acc, full);
    } else if (typeof v === 'string') {
      const set = new Set<string>();
      const re = /\{\{\s*(\w+)\s*\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(v)) !== null) {
        set.add(m[1] as string);
      }
      acc.set(full, [...set].sort());
    }
  }
};

describe('locale catalog completeness', () => {
  const locales = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  it('finds at least one locale directory', () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  it("parses every locale's JSON files without error", () => {
    for (const locale of locales) {
      expect(() => readLocale(locale)).not.toThrow();
    }
  });

  it('every locale exposes the same namespace set', () => {
    if (locales.length < 2) return;
    const reference = readLocale(locales[0] as string);
    const refNs = [...reference.namespaces.keys()].sort();
    for (const locale of locales.slice(1)) {
      const ns = [...readLocale(locale).namespaces.keys()].sort();
      expect(ns).toEqual(refNs);
    }
  });

  describe('parity across locales', () => {
    if (locales.length < 2) {
      it.skip('parity check skipped while only one locale is present', () => undefined);
      return;
    }

    const reference = readLocale(locales[0] as string);
    const others = locales.slice(1).map(readLocale);

    for (const ns of reference.namespaces.keys()) {
      const refRoot = reference.namespaces.get(ns) as Record<string, unknown>;
      const refKeys = collectKeys(refRoot);
      const refPlaceholders = new Map<string, ReadonlyArray<string>>();
      collectPlaceholders(refRoot, refPlaceholders);

      for (const other of others) {
        const otherRoot = (other.namespaces.get(ns) ?? {}) as Record<string, unknown>;
        it(`${other.locale} matches ${reference.locale} keys in ${ns}.json`, () => {
          expect(collectKeys(otherRoot)).toEqual(refKeys);
        });
        it(`${other.locale} matches ${reference.locale} placeholders in ${ns}.json`, () => {
          const placeholders = new Map<string, ReadonlyArray<string>>();
          collectPlaceholders(otherRoot, placeholders);
          for (const [key, expected] of refPlaceholders.entries()) {
            expect(placeholders.get(key) ?? []).toEqual(expected);
          }
        });
      }
    }
  });
});
